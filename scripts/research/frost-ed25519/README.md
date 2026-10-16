# FROST(Ed25519, SHA-512) research PoC

Research only, for issue #220. **Not for production.** It uses bigint arithmetic with no constant-time guarantees, a trusted dealer for keygen (no DKG, refresh or repair), and keeps everything in one process with no coordinator transport. Findings and the go/no-go are in [`docs/research/frost-go-no-go.md`](../../../docs/research/frost-go-no-go.md).

## Run

```bash
npx jest src/__tests__/frostResearchPoc.test.ts
```

This runs under the CJS jest project (`jest.config.mjs`) with no new dependencies. It uses `@noble/curves` 1.9.7, `@noble/hashes` 1.8.0, and the CSL fork that `@meshsdk/core-csl` re-exports as `csl` (`@sidan-lab/whisky-js-nodejs`). The full suite runs it too via `npm test`.

## What it proves (13 tests)

| Test                          | Claim                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RFC 9591 E.1 vector (2 tests) | Reproduces the group key, the 3 shares, the nonces, commitments, binding-factor inputs, binding factors, signature shares and the final signature **byte for byte**.         |
| (a) 2-of-3 and 3-of-5         | The aggregate signature passes noble's stock RFC 8032 `ed25519.verify` and the RFC 9591 cofactored check.                                                                    |
| (b) vkey witness              | `csl.PublicKey.verify(txBodyHash, sig)` is `true` over a real tx body hash. The `Vkeywitness` round-trips through CBOR and is 101 bytes, the same as any single-key witness. |
| (b) native script / address   | The blake2b-224 hash of the group key works as an `addr_test1v…` enterprise address and as a `sig` leaf inside a 2-of-3 `atLeast` native script.                             |
| (c) below threshold           | Interpolating over t−1 shares produces a well-formed signature that fails both verifiers.                                                                                    |
| (c) tampered message          | Flipping one bit of the tx hash fails both verifiers.                                                                                                                        |
| Nonce reuse                   | If a signer answers 3 different messages with one restored nonce pair, a coordinator solves a 3×3 linear system mod L and **recovers the signer's key share exactly**.       |

## What it does not prove

- **Wallet integration.** No CIP-30 wallet or Ledger/Trezor can hold a share or produce a signature share. That gap is the main blocker.
- **Production readiness.** There is no DKG, no share refresh, no constant-time code, and no secure nonce lifecycle. Any production work should use ZF `frost-ed25519` (Rust, NCC-audited at v0.6.0, now at 3.0.0) through WASM rather than this code.
- **On-chain submission.** Ledger acceptance follows from (b) because the node verifies vkey witnesses with standard Ed25519, but this PoC never submits a transaction to preprod.
