import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PINATA_JWT: z.string(),
    GITHUB_TOKEN: z.string().optional(),
    JWT_SECRET: z.string().min(32),
    BLOCKFROST_API_KEY_PREPROD: z.string().optional(),
    BLOCKFROST_API_KEY_MAINNET: z.string().optional(),
    // NEXTAUTH_SECRET:
    //   process.env.NODE_ENV === "production"
    //     ? z.string()
    //     : z.string().optional(),
    // NEXTAUTH_URL: z.preprocess(
    //   // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
    //   // Since NextAuth.js automatically uses the VERCEL_URL if present.
    //   (str) => process.env.VERCEL_URL ?? str,
    //   // VERCEL_URL doesn't include `https` so it cant be validated as a URL
    //   process.env.VERCEL ? z.string() : z.string().url()
    // ),
    // DISCORD_CLIENT_ID: z.string(),
    // DISCORD_CLIENT_SECRET: z.string(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET: z.string(),
    NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD: z.string(),
    NEXT_PUBLIC_UTXOS_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_NETWORK_ID: z.string().default("0"),
    /** Umami analytics: website ID from your Umami dashboard (cloud or self-hosted) */
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string().optional(),
    /** Umami script URL; default is Umami Cloud. Use your self-hosted URL if needed. */
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: z.string().url().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NODE_ENV: process.env.NODE_ENV,
    // NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    // NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    // DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    // DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET:
      process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET,
    NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD:
      process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD,
    NEXT_PUBLIC_UTXOS_PROJECT_ID: process.env.NEXT_PUBLIC_UTXOS_PROJECT_ID,
    NEXT_PUBLIC_NETWORK_ID: process.env.NEXT_PUBLIC_NETWORK_ID ?? "0",
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
    PINATA_JWT: process.env.PINATA_JWT,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    JWT_SECRET: process.env.JWT_SECRET,
    BLOCKFROST_API_KEY_PREPROD: process.env.BLOCKFROST_API_KEY_PREPROD,
    BLOCKFROST_API_KEY_MAINNET: process.env.BLOCKFROST_API_KEY_MAINNET,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});