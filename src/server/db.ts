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
        console.warn(
          `Database connection error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms...`,
          error instanceof Error ? error.message : String(error),
        );
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
  if (dbUrl && dbUrl.includes("supabase.com")) {
    const isPooler = dbUrl.includes("pooler");
    const hasWrongPort = dbUrl.includes(":5432");
    const hasCorrectPort = dbUrl.includes(":6543");
    
    // Critical error: Using pooler hostname with direct port
    if (isPooler && hasWrongPort) {
      console.error(
        "❌ CRITICAL: DATABASE_URL uses pooler hostname but wrong port (5432). " +
          "For Supabase connection pooler, you MUST use port 6543, not 5432. " +
          "Fix: Replace :5432 with :6543 in your DATABASE_URL. " +
          "Get correct URL from: Supabase Dashboard → Settings → Database → Connection Pooling → Transaction mode",
      );
    }
    // Error: Using direct connection instead of pooled
    else if (!isPooler && hasWrongPort) {
      console.error(
        "❌ DATABASE_URL is using direct connection (port 5432). " +
          "For Vercel serverless with Supabase, you MUST use the connection pooler URL (port 6543). " +
          "Get it from: Supabase Dashboard → Settings → Database → Connection Pooling → Transaction mode",
      );
    }
    // Warning: Pooler URL missing pgbouncer parameter
    else if (isPooler && hasCorrectPort && !dbUrl.includes("pgbouncer=true")) {
      console.warn(
        "⚠️  DATABASE_URL uses pooler but missing pgbouncer=true parameter. " +
          "Add ?pgbouncer=true to your connection string for optimal performance.",
      );
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
