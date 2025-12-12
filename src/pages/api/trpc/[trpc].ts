import { createNextApiHandler } from "@trpc/server/adapters/next";

import { env } from "@/env";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

// export API handler
export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  onError: ({ path, error, type }) => {
    // Log connection errors in production for debugging
    const isConnectionError =
      error.message.includes("Can't reach database server") ||
      error.message.includes("connection") ||
      error.message.includes("timeout") ||
      error.message.includes("P1001") ||
      error.message.includes("P1008") ||
      error.message.includes("P1017");

    if (isConnectionError) {
      console.error(
        `❌ Database connection error on ${path ?? "<no-path>"}: ${error.message}`,
      );
      // Log DATABASE_URL info (without credentials) for debugging
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
        try {
          const url = new URL(dbUrl);
          console.error(
            `Database URL: ${url.protocol}//${url.hostname}:${url.port}${url.pathname}`,
          );
        } catch {
          // Ignore URL parsing errors
        }
      }
    } else if (env.NODE_ENV === "development") {
      console.error(
        `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
      );
    }
  },
});
