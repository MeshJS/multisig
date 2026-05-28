/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 * 
 * Note: We use dynamic import here to avoid blocking Next.js initialization.
 * The env validation will happen when the module is actually used, not during config load.
 */
if (!process.env.SKIP_ENV_VALIDATION) {
  // Use dynamic import to avoid blocking initialization
  import("./src/env.js").catch((err) => {
    console.error("Failed to load env validation:", err);
  });
}

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ["geist", "@meshsdk/react"],
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
  // Empty config silences the warning about webpack/turbopack conflict
  // WebAssembly support is enabled by default in Turbopack
  turbopack: {},
  
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
    
    return config;
  },
  
  // External packages for server components to avoid bundling issues
  serverExternalPackages: ["@fabianbormann/cardano-peer-connect"],

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
