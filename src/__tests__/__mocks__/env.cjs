// Test stub for `@/env`.
//
// The real src/env.js calls `createEnv` from the ESM-only
// `@t3-oss/env-nextjs`, which the jest CommonJS runner cannot parse. Mapping
// `@/env` here lets any server module that imports it load under jest. Values
// come straight from process.env (seeded with dummy values by setupEnv.cjs),
// so tests can still override individual vars via `process.env.X = ...`.
const env = new Proxy(
  {},
  {
    get: (_target, key) => process.env[String(key)],
    has: (_target, key) => String(key) in process.env,
  },
);

module.exports = { env };
