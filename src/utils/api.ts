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
          enabled: (opts) => {
            // Don't log expected authorization errors (403/401 errors)
            if (opts.direction === "down" && opts.result instanceof Error) {
              const error = opts.result as { 
                code?: string; 
                message?: string; 
                data?: { code?: string; httpStatus?: number };
                shape?: { code?: string; message?: string };
              };
              const errorMessage = error.message || error.shape?.message || "";
              const isExpectedAuthError =
                error.code === "FORBIDDEN" ||
                error.code === "UNAUTHORIZED" ||
                error.data?.code === "FORBIDDEN" ||
                error.data?.code === "UNAUTHORIZED" ||
                error.data?.httpStatus === 403 ||
                error.data?.httpStatus === 401 ||
                error.shape?.code === "FORBIDDEN" ||
                error.shape?.code === "UNAUTHORIZED" ||
                errorMessage.includes("Address mismatch") ||
                errorMessage.includes("Not authorized") ||
                errorMessage.includes("Unauthorized");
              if (isExpectedAuthError) return false;
            }
            return process.env.NODE_ENV === "development";
          },
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
      queryClientConfig: {
        defaultOptions: {
          queries: {
            retry: (failureCount, error) => {
              // Don't retry on authorization errors (403/401)
              if (error && typeof error === "object") {
                const err = error as { 
                  code?: string; 
                  message?: string; 
                  data?: { code?: string; httpStatus?: number };
                  shape?: { code?: string; message?: string };
                };
                const errorMessage = err.message || err.shape?.message || "";
                const isAuthError =
                  err.code === "FORBIDDEN" ||
                  err.code === "UNAUTHORIZED" ||
                  err.data?.code === "FORBIDDEN" ||
                  err.data?.code === "UNAUTHORIZED" ||
                  err.data?.httpStatus === 403 ||
                  err.data?.httpStatus === 401 ||
                  err.shape?.code === "FORBIDDEN" ||
                  err.shape?.code === "UNAUTHORIZED" ||
                  errorMessage.includes("Address mismatch") ||
                  errorMessage.includes("Not authorized") ||
                  errorMessage.includes("Unauthorized");
                if (isAuthError) return false;
              }
              // Default retry behavior for other errors
              return failureCount < 3;
            },
          },
          mutations: {
            retry: (failureCount, error) => {
              // Don't retry mutations on authorization errors
              if (error && typeof error === "object") {
                const err = error as { 
                  code?: string; 
                  message?: string; 
                  data?: { code?: string; httpStatus?: number };
                  shape?: { code?: string; message?: string };
                };
                const errorMessage = err.message || err.shape?.message || "";
                const isAuthError =
                  err.code === "FORBIDDEN" ||
                  err.code === "UNAUTHORIZED" ||
                  err.data?.code === "FORBIDDEN" ||
                  err.data?.code === "UNAUTHORIZED" ||
                  err.data?.httpStatus === 403 ||
                  err.data?.httpStatus === 401 ||
                  err.shape?.code === "FORBIDDEN" ||
                  err.shape?.code === "UNAUTHORIZED" ||
                  errorMessage.includes("Address mismatch") ||
                  errorMessage.includes("Not authorized") ||
                  errorMessage.includes("Unauthorized");
                if (isAuthError) return false;
              }
              // Don't retry mutations by default
              return false;
            },
          },
        },
      },
    };
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
