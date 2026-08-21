// @ts-nocheck — env bootstrap; checkJs flags `NODE_ENV` as read-only
// because @types/node narrows it to a literal union, but writing it here
// is intentional and safe (runs before any test module is imported).
//
// Sets dummy env vars so that `src/env.js` (t3-oss validate) does not throw
// when test files import server modules transitively.
// Tests that need real values can override per-test with `process.env.X = ...`
// inside `beforeEach`.

process.env['NODE_ENV'] = process.env['NODE_ENV'] || 'test';
process.env.SKIP_ENV_VALIDATION = '1';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'a'.repeat(48);
process.env.PINATA_JWT = process.env.PINATA_JWT || 'test-pinata-jwt';

process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET =
  process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET || 'test-blockfrost-mainnet';
process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD =
  process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD || 'test-blockfrost-preprod';
process.env.NEXT_PUBLIC_NETWORK_ID = process.env.NEXT_PUBLIC_NETWORK_ID || '0';
