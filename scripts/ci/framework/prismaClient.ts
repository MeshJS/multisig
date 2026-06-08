import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma 7 requires a driver adapter (or Accelerate) instead of a schema/url
 * connection. Shared factory for standalone CI scenario scripts.
 *
 * The app runtime uses the retry-wrapped singleton in src/server/db.ts; these
 * scripts run outside Next.js and construct their own short-lived client, so
 * they read DATABASE_URL directly from the environment.
 */
export function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({ adapter });
}
