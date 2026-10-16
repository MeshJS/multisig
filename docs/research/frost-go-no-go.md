# FROST and post-quantum multi-sig: findings, PoC and go/no-go

Issue #220 · ROADMAP Month 6 research track · 2026-10-16 · Owner: Quirin

## 1. Summary and recommendation

**NO-GO on replacing native scripts with FROST. CONDITIONAL GO on an optional FROST signer as one leaf inside an existing native script. NO-GO on PQ multisig until the Cardano ledger can verify a PQ signature.**

FROST(Ed25519, SHA-512) does work on Cardano with no ledger change. Our PoC reproduces the RFC 9591 test vector byte for byte, and a 2-of-3 or 3-of-5 aggregate signature verifies as an ordinary vkey witness under the CSL fork Mesh ships. Replacing native scripts would save 206 bytes per transaction for 2-of-3 and 371 bytes for 3-of-5, which is 0.009 and 0.016 ADA in fees. That saving is too small to justify what it costs this platform:

- **Auditability is lost.** The signer set and threshold leave the chain, and DRep, CIP-1854 and treasury users rely on reading them there.
- **Hardware and CIP-30 support disappear.** No CIP-30 wallet, Ledger or Trezor can hold a share.
- **Custody shifts to new software.** Shares would live in software we would have to build, and that software has a key-leaking failure mode (nonce reuse, shown in the PoC).

"Lemour" does not exist under that name. The roadmap almost certainly means **Lemur** (Monash, NIST threshold call, 2026), a lattice *synchronized aggregate multi-signature*, not a t-of-n threshold scheme. It is pre-standard, has no public implementation, and produces signatures in the KB range. More decisively, no Cardano native script or Plutus builtin verifies any post-quantum signature today.

## 2. How FROST maps onto Cardano

[RFC 9591 §6.1](https://www.rfc-editor.org/rfc/rfc9591.html#section-6.1) defines FROST(Ed25519, SHA-512) "to produce Ed25519-compliant signatures as specified in Section 5.1 of RFC 8032". Its challenge hash H2 drops the domain separator "for compatibility with RFC 8032". The output is `R || z`, 64 bytes, under a 32-byte group public key. Verification is plain RFC 8032 §5.1.7 with the cofactored equation `[8][z]B = [8]R + [8][c]PK`.

On Cardano that means:

- **Address.** The group key's blake2b-224 hash is an ordinary 28-byte payment key hash. It can be an enterprise or base address credential, or a `sig` leaf in a native script ([CIP-1854](https://github.com/cardano-foundation/CIPs/blob/master/CIP-1854/README.md) scripts are built from such hashes).
- **Witness.** Spending needs **one** vkey witness `[vkey(32), sig(64)]`, measured at 101 bytes CBOR. The ledger cannot distinguish it from a single-key signature.
- **Script.** None is needed. With a pure FROST key, no native script is revealed on spend.

The PoC proves each of these (§5). One caveat: the ledger verifies only the final Ed25519 signature. It knows nothing about t, n or who signed, so every threshold guarantee lives off chain in the share holders' software.

## 3. Trade-offs: native script vs FROST

Fee inputs: mainnet `txFeePerByte` = **44 lovelace/B**, `txFeeFixed` = 155,381, `maxTxSize` = 16,384, protocol 11.0 ([Koios protocol params](https://api.koios.rest/api/v1/cli_protocol_params), fetched 2026-10-16). Sizes were measured with `csl` (whisky-js 1.0.25): `sig` leaf 32 B, vkey witness 101 B, `atLeast` 2-of-3 script 100 B, 3-of-5 script 164 B.

| | 2-of-3 native | 2-of-3 FROST | 3-of-5 native | 3-of-5 FROST |
|---|---|---|---|---|
| Vkey witnesses | 2 × 101 (array 206) | 1 × 101 (array 105) | 3 × 101 (array 307) | array 105 |
| Script in witness set | 100 | 0 | 164 | 0 |
| Witness set total (measured) | **313 B** | **107 B** | **478 B** | **107 B** |
| Saving | | **206 B × 44 = 9,064 lovelace ≈ 0.009 ADA** | | **371 B × 44 = 16,324 lovelace ≈ 0.016 ADA** |
| Share of a typical ~0.2 ADA multisig tx fee | | ~4–5 % | | ~7–8 % |

The saving per extra signer is about 101 B (one witness) plus 32 B (one leaf), so roughly 0.006 ADA. Address size is unchanged: both forms are 28-byte credentials. A reference script removes the inline script bytes from the native-script side, but it has its own UTxO and ref-script costs, so the figures above favour FROST.

| Dimension | Native script (today) | FROST |
|---|---|---|
| On-chain footprint | Grows with m and n (above) | Constant: 1 witness, 0 script |
| Privacy | Script, key hashes and threshold are public once spent | Looks like a single-key wallet, with no signer set visible |
| **Auditability of signer set and threshold** | Anyone can verify "3-of-5 of these keys" from the chain. This app's DRep pages, CIP-1854 discovery (`src/utils/cip146Discovery.ts`) and governance rationale rely on it. | **Lost.** t, n and membership are claims made off chain. A DRep credential backed by FROST is indistinguishable from one key, so voters cannot check the committee. |
| Key rotation / membership change | New script, so a **new address**. Funds must move, and DRep or stake credentials must be re-registered. | Resharing (ZF `refresh`) **keeps the address and credential**. This is FROST's strongest real advantage. |
| Threshold change | New script | Resharing can't change it either: ZF `refresh` cannot change `min_signers` ([CVE-2025-58359](https://vuln.today/cve/CVE-2025-58359), fixed in frost-core 2.2.0, which made this explicit). Changing the threshold needs a new DKG, a new key and a new address. |
| Signer UX and wallets | Any CIP-30 wallet, Ledger or Trezor signs with `signTx` | **None.** [CIP-30](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/README.md) exposes only `signTx` and `signData` (COSE-wrapped) over wallet-held keys, with no way to supply a share or nonce. We found no Ledger or Trezor Cardano app with FROST support. Bitcoin's Frostsnap is dedicated hardware ([2023, pre-release then](https://nobsbitcoin.com/frostsnap-frost-multisig-foss)). |
| Liveness and coordination | Asynchronous: each signer adds a witness whenever they like, which matches the app's pending-tx flow | 2 rounds. Round 1 commitments can be preprocessed, but round 2 needs a fixed signer subset, so one dropout restarts the round. A coordinator is required. |
| Secret state | None beyond the wallet key | Per-session nonces that **must** be single-use. Restoring one nonce pair 3× leaks the share (PoC test). |
| Custody model | Keys in users' own wallets or hardware | Shares in a new app-specific signer (browser, WASM or server), which is a custody product we would own and have audited |
| Failure modes | Lost key: the other m-of-n still sign | Lost share: repairable (ZF RTS) while ≥ t remain. Compromised coordinator: denial of service only. **Buggy signer or nonce reuse: silent key theft.** Software bug: all funds behind one key. |
| Ecosystem tooling | All Cardano tooling understands native scripts | Explorers show a single key. Nothing in Cardano tooling exposes the threshold. |

## 4. Library and maturity assessment

| Library | Lang | Status |
|---|---|---|
| [ZF FROST](https://github.com/ZcashFoundation/frost) `frost-ed25519` | Rust | Implements RFC 9591. Supports trusted-dealer and DKG keygen, refresh, and repairable threshold. [NCC Group audit](https://www.nccgroup.com/research/public-report-zcash-frost-security-assessment/) of v0.6.0 in 2023 (frost-core, -ed25519 and others; "all findings were fixed"). Current release is **3.0.0 (2026-04-23)** with ~530k downloads ([crates.io](https://crates.io/crates/frost-ed25519)). Later versions are not re-audited per the repo. One CVE (2025-58359, refresh semantics). **Production-grade candidate; would need a WASM build for the browser.** |
| [`@substrate-system/frost`](https://github.com/substrate-system/frost) | TS | Claims RFC 9591 Ed25519. 4 stars, no releases, no audit. Not usable for custody. |
| Viper Science, [Catalyst F11 "Threshold Signatures for Cardano Wallets"](https://www.lidonation.com/proposals/threshold-signatures-for-cardano-wallets-f11) | C++ | Funded at 75k ADA (12k disbursed per Lido Nation). Uses Shamir-split Ed25519 producing standard Ed25519 signatures, but it is not described as FROST and no public repo is linked. |
| IOG | — | The [Cardano Vision 2026 research program](https://www.iog.io/news/cardano-vision-2026-the-research-program-securing-cardano) mentions threshold signatures only for cross-chain coordination, not FROST wallets. |
| This PoC | TS | Reproduces the RFC vector. Research only: not constant-time, trusted dealer. |

**Verdict.** The cryptography is mature (RFC plus an audited Rust library). The Cardano wallet layer has nothing: no CIP, no wallet, no hardware.

## 5. PoC results

- **Code.** [`scripts/research/frost-ed25519/frost.ts`](../../scripts/research/frost-ed25519/frost.ts) implements RFC 9591 §4–5 and §6.1 (contextString `FROST-ED25519-SHA512-v1`, H1–H5) on `@noble/curves` 1.9.7 with no new dependencies. It includes trusted-dealer Shamir with Feldman VSS, two-round signing, binding factors, Lagrange coefficients, share verification and aggregation.
- **Tests.** [`src/__tests__/frostResearchPoc.test.ts`](../../src/__tests__/frostResearchPoc.test.ts), run with `npx jest src/__tests__/frostResearchPoc.test.ts`. **13 of 13 pass** (about 3 s).
  - **RFC 9591 Appendix E.1 reproduced byte for byte.** That covers the group key, the 3 shares, nonces, commitments, binding-factor inputs and factors, both sig shares, and the final `sig 36282629…3160b`.
  - **(a)** 2-of-3 and 3-of-5 signatures, from two different qualifying subsets each, verify with noble's stock `ed25519.verify` and the cofactored check.
  - **(b)** `csl.PublicKey.from_bytes(groupPk).verify(txBodyHash, sig)` returns `true` over a real tx body hash computed with `resolveTxHash`. The `Vkeywitness` round-trips at 101 B. The group key hash builds an `addr_test1v…` enterprise address and serves as a `sig` leaf in a 2-of-3 `atLeast` script.
  - **(c)** t−1 shares and a 1-bit tampered message both fail under both verifiers. **Nonce reuse:** 3 signatures from one restored nonce pair let a coordinator recover the victim's share exactly.
- **Not done.** No preprod submission. Acceptance follows from (b), since the ledger checks vkey witnesses with standard Ed25519. No DKG and no wallet integration.

## 6. Post-quantum: "Lemour" and the lattice threshold landscape

- **"Lemour".** No scheme or library with this name exists in the sources we searched (IACR ePrint, NIST, general web). The nearest match is **Lemur: Scalable Post-Quantum Synchronized Multi-Signatures** (Lin, Esgin, Sakzad, Steinfeld, Saarinen; [ePrint 2026/1161](https://eprint.iacr.org/2026/1161); [NIST TCPT2 talk, 2026-07-08](https://csrc.nist.gov/presentations/2026/tcpt2-2a2)).
  - **What it is.** A lattice (Module-LWE/SIS, "Dual Hint-MLWE") *synchronized aggregate multi-signature*. Signers in the same time step aggregate non-interactively. It is **not a t-of-n threshold scheme** and is stateful (Merkle-tree one-time keys, height 20).
  - **Sizes.** 380 KB aggregate for 2^20 signers, 15 ms batch verification for 1,024 signers. The authors also estimate that predecessor Chipmunk reaches only ~30-bit rather than the claimed 112-bit security.
  - **Implementation.** The paper mentions a Rust implementation, but no public repo is linked.
- **Threshold lattice schemes.**
  - [Ringtail](https://eprint.iacr.org/2024/1113) (IEEE S&P 2025) is a 2-round LWE threshold scheme with 13.4 KB signatures at t = 1024.
  - The [NIST Multi-Party Threshold call](https://csrc.nist.gov/projects/threshold-cryptography/tcall-1) is in its *preview* phase. Phase 3 talks run through 2026-10-13, and **packages are due around March 2027** (spec, open-source reference implementation, evaluation). The call includes lattice entries (Lemur, LoTRS, Tanuki, LaTSEC, Thimza, TalonG), threshold ML-DSA (Mithril, Quorus, TALUS), threshold Falcon (ATMACA) and threshold HAWK (Kettle). No PQ threshold standard exists yet.
- **Trade-offs vs FROST.**
  - FROST is classical: discrete log, broken by Shor. Even FROST's privacy gain is weaker against a quantum adversary, because the group public key is revealed on first spend, exactly like any Ed25519 key.
  - Lattice threshold signatures are 13 KB+ against 64 B, which is about 80% of `maxTxSize` (16,384 B) per signature before anything else.
- **The gate.** Cardano native scripts check only Ed25519 vkey witnesses. The [Plutus builtins](https://plutus.cardano.intersectmbo.org/haddock/master/plutus-core/PlutusCore-Default-Builtins.html) offer only `VerifyEd25519Signature`, `VerifyEcdsaSecp256k1Signature`, `VerifySchnorrSecp256k1Signature` and BLS12-381 primitives, with **no PQ signature verification of any kind**. The one escape hatch is a hash-based one-time signature (Lamport or WOTS) verified in a Plutus validator using hash builtins. That would be a custom, stateful, high-ex-unit contract rather than a native-script multisig, and it has nothing to do with lattice threshold schemes. IOG's 2026 research program lists PQ signatures as research, still to be designed, with a migration SIP planned, and gives no dates. [CIP-0197](https://coingape.com/cardano-opens-review-on-quantum-proof-wallet-cip-as-upgrade-2026-gains-momentum/) (in review since 2026-08-23) adds ZK seed-ownership proofs on top of Ed25519 and is not a PQ signature scheme. A PQ multisig on Cardano therefore needs a hard fork that adds a PQ verification primitive. An application cannot build one today.

**PQ verdict: NO-GO and keep watching.** Re-assess when (i) NIST MPTS packages land (around March 2027) and (ii) a Cardano CIP adds a PQ signature builtin or witness type.

## 7. Go/no-go

| Option | Verdict |
|---|---|
| Replace native-script wallets with FROST | **NO-GO** |
| Optional FROST signer as **one leaf** inside an existing native script | **CONDITIONAL GO** (research-grade, opt-in) |
| PQ (Lemur or lattice threshold) multisig | **NO-GO** (ledger-gated) |

**Why the hybrid.** A native script such as `atLeast 2 [ alice, bob, FROST(ops-team 3-of-5) ]` keeps the top-level policy auditable on chain, keeps hardware-wallet signers, and lets a sub-team share one seat. It also gets FROST's rotation benefit, because the sub-team can reshare and keep its leaf hash with no change to the wallet address. The PoC already builds this script.

**Conditions before building it:**
1. Signer built on ZF `frost-ed25519` 3.x via WASM, not this PoC, with an audit of the WASM wrapper and nonce handling.
2. DKG instead of a trusted dealer.
3. Nonce state never persisted, or persisted with single-use enforcement.
4. A UI label that makes clear a leaf is a FROST group, so auditability of that seat is explicitly off chain.
5. Demand from at least one real wallet team.

**What would flip the main NO-GO:**
- A CIP-30 extension, or Ledger/Trezor apps, that hold FROST shares.
- An on-chain way to attest the threshold.
- A user base where privacy outweighs auditability, which is not the case for DRep or treasury wallets.

**Next step (if the hybrid is pursued).** A 2-week spike: compile `frost-ed25519` to WASM, run DKG and signing between two browser tabs over the existing pending-tx channel, and submit a preprod spend from a native script containing one FROST leaf. Exit criterion: confirmed on preprod and reviewed by a second engineer. Otherwise, close #220 with this document.
