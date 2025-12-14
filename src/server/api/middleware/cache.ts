/**
 * tRPC Caching Middleware
 * 
 * Note: Server-side caching for tRPC is handled by React Query on the client.
 * This middleware is a placeholder for future server-side caching implementation
 * (e.g., using Redis or Next.js unstable_cache).
 * 
 * For now, it simply passes through - actual caching happens via:
 * 1. React Query client-side caching (configured in src/utils/api.ts)
 * 2. Next.js API route caching (configured per-route)
 */

import { TRPCError } from "@trpc/server";

/**
 * Cache configuration for different query types
 */
export const QUERY_CACHE_CONFIG = {
  // User data (1min cache)
  USER: {
    revalidate: 60,
    tags: ["user"],
  },
  // Wallet data (1min cache)
  WALLET: {
    revalidate: 60,
    tags: ["wallet"],
  },
  // Transaction data (30s cache for pending, 2min for history)
  TRANSACTION_PENDING: {
    revalidate: 30,
    tags: ["transaction", "pending"],
  },
  TRANSACTION_HISTORY: {
    revalidate: 2 * 60,
    tags: ["transaction", "history"],
  },
  // Proxy data (2min cache)
  PROXY: {
    revalidate: 2 * 60,
    tags: ["proxy"],
  },
  // Ballot data (1min cache)
  BALLOT: {
    revalidate: 60,
    tags: ["ballot"],
  },
  // Static/reference data (5min cache)
  STATIC: {
    revalidate: 5 * 60,
    tags: ["static"],
  },
} as const;

/**
 * Generate cache key from procedure path and input
 */
function getCacheKey(path: string, input: unknown): string {
  const inputStr = JSON.stringify(input, Object.keys(input as Record<string, unknown>).sort());
  return `trpc_${path}_${Buffer.from(inputStr).toString("base64url")}`;
}

/**
 * Determine cache config based on procedure path
 */
function getCacheConfigForPath(path: string): typeof QUERY_CACHE_CONFIG[keyof typeof QUERY_CACHE_CONFIG] | null {
  // User queries
  if (path.startsWith("user.")) {
    return QUERY_CACHE_CONFIG.USER;
  }
  
  // Wallet queries
  if (path.startsWith("wallet.")) {
    return QUERY_CACHE_CONFIG.WALLET;
  }
  
  // Transaction queries
  if (path.startsWith("transaction.")) {
    if (path.includes("pending") || path.includes("Pending")) {
      return QUERY_CACHE_CONFIG.TRANSACTION_PENDING;
    }
    return QUERY_CACHE_CONFIG.TRANSACTION_HISTORY;
  }
  
  // Proxy queries
  if (path.startsWith("proxy.")) {
    return QUERY_CACHE_CONFIG.PROXY;
  }
  
  // Ballot queries
  if (path.startsWith("ballot.")) {
    return QUERY_CACHE_CONFIG.BALLOT;
  }
  
  // Default: no caching for mutations or unknown queries
  return null;
}

/**
 * Caching middleware for tRPC queries
 * 
 * Currently a no-op pass-through middleware. Caching is handled by:
 * 1. React Query on the client side (configured in src/utils/api.ts)
 * 2. Next.js API route caching headers (configured per-route)
 * 
 * Future: Can be extended to use Redis or Next.js unstable_cache for
 * server-side cross-request caching.
 * 
 * Only applies to queries (not mutations).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCacheMiddleware(t: any) {
  return t.middleware(async ({ path, type, next }: { path: string; type: string; next: () => Promise<unknown> }) => {
    // Only apply to queries, not mutations
    if (type !== "query") {
      return next();
    }

    // For now, just pass through
    // Actual caching happens via React Query on the client
    // and Next.js cache headers on API routes
    try {
      return await next();
    } catch (error) {
      // Re-throw TRPC errors
      if (error instanceof TRPCError) {
        throw error;
      }
      // For other errors, log and re-throw
      console.error(`[Cache Middleware] Error in query ${path}:`, error);
      throw error;
    }
  });
}

/**
 * Helper to create cache tags for invalidation
 */
export function getCacheTagsForPath(path: string): string[] {
  const config = getCacheConfigForPath(path);
  return config?.tags ? [...config.tags] : [];
}

