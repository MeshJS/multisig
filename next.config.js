/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 * 
 * Note: We use dynamic import here to avoid blocking Next.js initialization.
 * The env validation will happen when the module is actually used, not during config load.
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/**
 * Real location of `@utxos/sdk`, for the browser-only alias below. Resolved
 * through the package's own entry so it follows whatever version is installed.
 */
const UTXOS_SDK_REAL = require.resolve("@utxos/sdk").replace(/index\.c?js$/, "index.js");

if (!process.env.SKIP_ENV_VALIDATION) {
  // Use dynamic import to avoid blocking initialization
  import("./src/env.js").catch((err) => {
    console.error("Failed to load env validation:", err);
  });
}

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ["geist", "@meshsdk/react", "@meshsdk/core-csl"],
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "*.discordapp.com",
      },
      {
        protocol: "https",
        hostname: "ipfs.io",
      },
      {
        protocol: "https",
        hostname: "gateway.pinata.cloud",
      },
    ],
    // Allow unoptimized images for local proxy API routes
    unoptimized: false,
  },
  // Turbopack configuration (Next.js 16+)
  // Pin the workspace root to this config's directory. Without this, Turbopack
  // can mis-detect the root when stray lockfiles exist higher up the tree (e.g.
  // a git worktree under a parent that also has a package-lock.json), which
  // breaks resolution of the whisky WASM during dev SSR. `import.meta.dirname`
  // is the project root in every checkout, so this is safe in CI and prod too.
  // WebAssembly support is enabled by default in Turbopack.
  turbopack: {
    root: import.meta.dirname,
    // Same lazy UTXOS stand-in as the webpack alias below, for `next dev`.
    resolveAlias: {
      "@utxos/sdk": { browser: "./src/lib/utxos-sdk-lazy.ts" },
      "@utxos/sdk-real": { browser: UTXOS_SDK_REAL },
    },
  },
  
  // Webpack config for builds that explicitly use webpack (e.g., with --webpack flag)
  webpack: function (config, options) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };
    
    // Optimize tree-shaking by ensuring proper module resolution.
    // Note: do NOT set `sideEffects: false` globally — it tells webpack that
    // every file is side-effect-free, which silently strips CSS imports,
    // polyfills, and other modules that exist purely for their side effects.
    // Per-package sideEffects flags in package.json are the correct surface.
    config.optimization = {
      ...config.optimization,
      usedExports: true,
    };

    // Handle CommonJS modules that don't support named exports
    config.resolve = {
      ...config.resolve,
      extensionAlias: {
        ".js": [".js", ".ts", ".tsx"],
      },
    };

    // Browser builds: route every `@utxos/sdk` import (ours and @meshsdk/react's)
    // through a lazy stand-in, so the SDK's ~15 MB of inlined Spark WASM loads
    // only when someone picks the UTXOS wallet. See src/lib/utxos-sdk-lazy.ts.
    if (!options.isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@utxos/sdk$": path.resolve(import.meta.dirname, "src/lib/utxos-sdk-lazy.ts"),
        "@utxos/sdk-real$": UTXOS_SDK_REAL,
      };
    }
    
    return config;
  },
  
  // External packages for server components to avoid bundling issues.
  // The whisky WASM packages (pulled by @meshsdk/core-csl 1.9) must be loaded as
  // CommonJS at runtime rather than bundled — webpack can't statically resolve
  // their WASM-backed ESM named exports during `next build` on Linux
  // (`does not provide an export named 'js_evaluate_tx_scripts'`). Externalizing
  // them makes Node `require` the cjs/ build, which loads the WASM synchronously.
  serverExternalPackages: [
    "@fabianbormann/cardano-peer-connect",
    "whisky-evaluator",
    "@sidan-lab/whisky-js-nodejs",
  ],

  // The MCP transaction review card is rendered with `next/og` in the Node
  // runtime (src/lib/tx-review/render-png.ts). Its bundle loads resvg.wasm,
  // yoga.wasm and the Geist face through `import.meta.url`, which output file
  // tracing cannot see — without this the deployed function has the JS but
  // not the assets.
  outputFileTracingIncludes: {
    "/api/mcp": ["./node_modules/next/dist/compiled/@vercel/og/**/*"],
  },

  // OAuth discovery documents must live under /.well-known/, but Next ignores
  // dot-directories inside pages/, so they cannot be files. Rewrites map the
  // well-known paths onto real API routes.
  //
  // RFC 9728 defines a path-aware form for protected-resource metadata
  // (/.well-known/oauth-protected-resource + the resource's path). Clients probe
  // that first and fall back to the root form, so both are served.
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/metadata/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/metadata/protected-resource',
      },
    ];
  },

  // Basic security headers applied to all routes.
  // NOTE: Content-Security-Policy and Strict-Transport-Security are intentionally
  // omitted — CSP would break inline scripts/styles and HSTS locks browsers to
  // HTTPS for max-age and should only be enabled after team review.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

// Bundle analyzer - only enable when ANALYZE env var is set
/** @type {(config: import("next").NextConfig) => import("next").NextConfig} */
const withBundleAnalyzer = process.env.ANALYZE === 'true' 
  ? require('@next/bundle-analyzer')({
      enabled: true,
    })
  : (config) => config;

export default withBundleAnalyzer(config);
