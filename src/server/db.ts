import { PrismaClient, Prisma } from "@prisma/client";

import { env } from "@/env";

// Connection retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

// Check if error is a connection error that should be retried
const isConnectionError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P1001: Can't reach database server
    // P1008: Operations timed out
    // P1017: Server has closed the connection
    return ["P1001", "P1008", "P1017"].includes(error.code);
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const message = error.message.toLowerCase();
    return (
      message.includes("can't reach database server") ||
      message.includes("connection") ||
      message.includes("timeout") ||
      message.includes("econnrefused")
    );
  }
  // Check for generic connection errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("can't reach database server") ||
      message.includes("connection") ||
      message.includes("timeout") ||
      message.includes("econnrefused")
    );
  }
  return false;
};

// Retry wrapper for database operations with exponential backoff
const withRetry = async <T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0 && isConnectionError(error)) {
      // Exponential backoff: 500ms, 1000ms, 2000ms
      const attempt = MAX_RETRIES - retries + 1;
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      
      if (env.NODE_ENV === "development") {
        console.warn(`Database connection error, retrying in ${delay}ms (${attempt}/${MAX_RETRIES})`);
      }
      
      await new Promise((resolve) => setTimeout(resolve, delay));
      
      // Try to reconnect before retrying
      try {
        await prismaClient.$connect();
      } catch {
        // Ignore connection errors here, let the retry handle it
      }
      
      return withRetry(operation, retries - 1);
    }
    throw error;
  }
};

const createPrismaClient = () => {
  // Validate DATABASE_URL is using pooled connection for Supabase
  const dbUrl = env.DATABASE_URL;
  if (dbUrl) {
    try {
      // Properly parse URL to validate hostname instead of substring matching
      const url = new URL(dbUrl);
      const hostname = url.hostname.toLowerCase();
      const port = url.port ? parseInt(url.port, 10) : (url.protocol === "postgresql:" ? 5432 : null);
      const isSupabase = hostname.endsWith(".supabase.com") || hostname === "supabase.com";
      const isPooler = hostname.includes("pooler");
      const searchParams = new URLSearchParams(url.search);
      const hasPgbouncer = searchParams.has("pgbouncer") && searchParams.get("pgbouncer") === "true";
      
      if (isSupabase) {
        if (isPooler && port === 5432) {
          console.error("DATABASE_URL: pooler hostname requires port 6543, not 5432");
        } else if (!isPooler && port === 5432) {
          console.error("DATABASE_URL: use connection pooler (port 6543) for serverless");
        } else if (isPooler && port === 6543 && !hasPgbouncer) {
          console.warn("DATABASE_URL: add ?pgbouncer=true for optimal performance");
        }
      }
    } catch (error) {
      // If URL parsing fails, log warning but don't block initialization
      // Prisma will handle invalid URLs with its own error messages
      if (env.NODE_ENV === "development") {
        console.warn("Could not parse DATABASE_URL for validation:", error);
      }
    }
  }

  const client = new PrismaClient({
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

  return client;
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

// Create or reuse Prisma client
const prismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prismaClient;
}

// Create a wrapper that adds retry logic to all Prisma operations
// We'll intercept model access and wrap query methods
const createRetryProxy = <T extends object>(target: T): T => {
  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop as keyof T];
      
      // If it's a model (user, wallet, etc.), wrap its methods
      if (value && typeof value === "object" && !prop.toString().startsWith("$")) {
        return createRetryProxy(value as object);
      }
      
      // If it's a function (query method), wrap it with retry logic
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          return withRetry(() => {
            const result = value.apply(obj, args);
            return result instanceof Promise ? result : Promise.resolve(result);
          });
        };
      }
      
      return value;
    },
  }) as T;
};

// Export db with retry logic
export const db = createRetryProxy(prismaClient);

// Graceful shutdown handling
if (typeof process !== "undefined") {
  const disconnect = async () => {
    try {
      await prismaClient.$disconnect();
    } catch (error) {
      // Ignore errors during shutdown
    }
  };

  process.on("beforeExit", disconnect);
  process.on("SIGINT", async () => {
    await disconnect();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await disconnect();
    process.exit(0);
  });
}
