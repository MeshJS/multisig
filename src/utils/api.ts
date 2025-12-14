/**
 * This is the client-side entrypoint for your tRPC API. It is used to create the `api` object which
 * contains the Next.js App-wrapper, as well as your type-safe React Query hooks.
 *
 * We also create a few inference helpers for input and output types.
 */
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import superjson from "superjson";

import { type AppRouter } from "@/server/api/root";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return ""; // browser should use relative url
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR should use vercel url
  return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

/** A set of type-safe react-query hooks for your tRPC API. */
export const api = createTRPCNext<AppRouter>({
  config() {
    return {
      /**
       * Links used to determine request flow from client to server.
       *
       * @see https://trpc.io/docs/links
       */
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpBatchLink({
          /**
           * Transformer used for data de-serialization from the server.
           *
           * @see https://trpc.io/docs/data-transformers
           */
          transformer: superjson,
          url: `${getBaseUrl()}/api/trpc`,
        }),
      ],
    };
  },
  /**
   * React Query configuration for global defaults.
   * These defaults can be overridden per-query when needed.
   */
  queryClientConfig: {
    defaultOptions: {
      queries: {
        // Data is considered fresh for 5 minutes
        staleTime: 5 * 60 * 1000, // 5 minutes
        // Cached data is kept for 10 minutes after last use
        gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
        // Don't refetch when window regains focus
        refetchOnWindowFocus: false,
        // Don't refetch on mount if data is stale (use cached data)
        refetchOnMount: false,
        // Retry failed requests once
        retry: 1,
        // Retry delay: exponential backoff starting at 1s
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        // Use structural sharing to prevent unnecessary re-renders when data hasn't changed
        structuralSharing: true,
      },
      mutations: {
        // Retry mutations once on failure
        retry: 1,
      },
    },
  },
  /**
   * Whether tRPC should await queries when server rendering pages.
   *
   * @see https://trpc.io/docs/nextjs#ssr-boolean-default-false
   */
  ssr: false,
  transformer: superjson,
});

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
