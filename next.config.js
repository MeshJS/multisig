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
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  transpilePackages: ["geist"],
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
    
    // Optimize tree-shaking by ensuring proper module resolution
    config.optimization = {
      ...config.optimization,
      usedExports: true,
      sideEffects: false,
    };
    
    return config;
  },
};

// Bundle analyzer - only enable when ANALYZE env var is set
const withBundleAnalyzer = process.env.ANALYZE === 'true' 
  ? require('@next/bundle-analyzer')({
      enabled: true,
    })
  : (config) => config;

export default withBundleAnalyzer(config);
