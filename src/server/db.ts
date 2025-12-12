import { PrismaClient } from "@prisma/client";

import { env } from "@/env";

const createPrismaClient = () => {
  const client = new PrismaClient({
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

  // In serverless environments (Vercel), we want to avoid eager connection
  // Prisma will connect lazily on first query, which is better for cold starts
  // Don't call $connect() here - let Prisma handle connections on-demand

  return client;
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

// Reuse Prisma client across invocations to optimize connection pooling
// In Vercel serverless, the same container may handle multiple requests
// Reusing the client prevents creating new connections for each request
export const db =
  globalForPrisma.prisma ?? createPrismaClient();

// Store in globalThis for reuse across all environments
// This is especially important in serverless where the same container
// may handle multiple requests, allowing connection reuse
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = db;
}

// Graceful shutdown handling
if (typeof process !== "undefined") {
  process.on("beforeExit", async () => {
    await db.$disconnect();
  });

  process.on("SIGINT", async () => {
    await db.$disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await db.$disconnect();
    process.exit(0);
  });
}
