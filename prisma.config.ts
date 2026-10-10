import "dotenv/config";
import { defineConfig } from "@prisma/config";

// Prisma 7 moved connection URLs out of schema.prisma. The CLI (migrate, db
// push, studio) reads the datasource URL from here. Migrations must run against
// the direct, non-pooled connection (DIRECT_URL) to bypass pgbouncer; we fall
// back to DATABASE_URL for local/dev setups without a separate direct URL.
// The runtime client connection (pooled DATABASE_URL) is configured separately
// in src/server/db.ts via the PrismaClient `datasourceUrl` option.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
