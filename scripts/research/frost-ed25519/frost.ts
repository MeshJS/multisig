/**
 * FROST(Ed25519, SHA-512) — RFC 9591 research proof of concept.
 *
 * RESEARCH ONLY. NOT FOR PRODUCTION.
 *  - No constant-time guarantees: scalar arithmetic uses JS bigint, which leaks
 *    timing. Secret shares and nonces must never pass through this code in a
 *    real deployment.
 *  - Trusted-dealer key generation only (RFC 9591 Appendix C). No DKG, no
 *    share refresh, no repair.
 *  - No coordinator networking, no persistence, no protection against nonce
 *    reuse beyond what the caller does (see `SigningNonces`).
 *  - Written to answer one question for issue #220: can a FROST group key sit
 *    in a Cardano address / native-script `sig` leaf as one ordinary Ed25519
 *    key, witnessed by one ordinary vkey witness? See
 *    docs/research/frost-go-no-go.md.
 *
 * Follows RFC 9591 Sections 4, 5 and 6.1 and reproduces the Appendix E.1 test
 * vector byte-for-byte (src/__tests__/frostResearchPoc.test.ts).
 */
import { ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import {
  bytesToHex,
  bytesToNumberLE,
  concatBytes,
  hexToBytes,
  numberToBytesLE,
  randomBytes,
} from "@noble/curves/utils";

const Point = ed25519.Point;
type Point = InstanceType<typeof ed25519.Point>;

/** Group order L = 2^252 + 27742317777372353535851937790883648493. */
export const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const CONTEXT = new TextEncoder().encode("FROST-ED25519-SHA512-v1");
const utf8 = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// Scalar field helpers
// ---------------------------------------------------------------------------

export const mod = (a: bigint): bigint => {
  const r = a % L;
  return r >= 0n ? r : r + L;
};

export function invert(a: bigint): bigint {
  // Fermat: a^(L-2) mod L. L is prime.
  let base = mod(a);
  if (base === 0n) throw new Error("invert(0)");
  let e = L - 2n;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * base) % L;
    base = (base * base) % L;
    e >>= 1n;
  }
  return r;
}

export const serializeScalar = (s: bigint): Uint8Array =>
  numberToBytesLE(mod(s), 32);

export function deserializeScalar(buf: Uint8Array): bigint {
  if (buf.length !== 32) throw new Error("scalar must be 32 bytes");
  const s = bytesToNumberLE(buf);
  if (s >= L) throw new Error("non-canonical scalar");
  return s;
}

export function serializeElement(P: Point): Uint8Array {
  if (P.is0()) throw new Error("cannot serialize identity element");
  return P.toBytes();
}

export function deserializeElement(buf: Uint8Array): Point {
  const P = Point.fromBytes(buf);
  if (P.is0()) throw new Error("identity element");
  if (!P.isTorsionFree()) throw new Error("point not in prime-order subgroup");
  return P;
}

/** [s]B, allowing s = 0 (noble's multiply rejects 0). */
const baseMul = (s: bigint): Point =>
  mod(s) === 0n ? Point.ZERO : Point.BASE.multiply(mod(s));
const pointMul = (P: Point, s: bigint): Point =>
  mod(s) === 0n ? Point.ZERO : P.multiply(mod(s));

// ---------------------------------------------------------------------------
// RFC 9591 Section 6.1 hash functions
// ---------------------------------------------------------------------------

const hashToScalar = (...parts: Uint8Array[]) =>
  mod(bytesToNumberLE(sha512(concatBytes(...parts))));

export const H1 = (m: Uint8Array) => hashToScalar(CONTEXT, utf8("rho"), m);
/** H2 deliberately has no domain separator: RFC 8032 compatibility. */
export const H2 = (m: Uint8Array) => hashToScalar(m);
export const H3 = (m: Uint8Array) => hashToScalar(CONTEXT, utf8("nonce"), m);
export const H4 = (m: Uint8Array) =>
  sha512(concatBytes(CONTEXT, utf8("msg"), m));
export const H5 = (m: Uint8Array) =>
  sha512(concatBytes(CONTEXT, utf8("com"), m));

// ---------------------------------------------------------------------------
// Key generation — trusted dealer (RFC 9591 Appendix C)
// ---------------------------------------------------------------------------

export interface KeyShare {
  identifier: bigint; // NonZeroScalar, 1..n
  secretShare: bigint; // s_i
  publicShare: Point; // PK_i = [s_i]B
}

export interface KeyPackage {
  groupPublicKey: Point;
  threshold: number;
  shares: KeyShare[];
  /** Polynomial commitment (VSS), [a_j]B for j=0..t-1. */
  vssCommitment: Point[];
}

export function randomScalar(): bigint {
  // 64 bytes reduced mod L: bias < 2^-250.
  return mod(bytesToNumberLE(randomBytes(64)));
}

function evalPoly(coeffs: bigint[], x: bigint): bigint {
  // Horner, coeffs[0] is the constant term.
  let acc = 0n;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = mod(acc * x + coeffs[i]!);
  return acc;
}

/**
 * Shamir-split `groupSecret` into `maxSigners` shares, `minSigners` of which
 * reconstruct it. `coefficients` (a_1..a_{t-1}) may be passed for test vectors.
 */
export function trustedDealerKeygen(
  groupSecret: bigint,
  maxSigners: number,
  minSigners: number,
  coefficients?: bigint[],
): KeyPackage {
  if (minSigners < 2 || minSigners > maxSigners) {
    throw new Error("require 2 <= minSigners <= maxSigners");
  }
  const rest =
    coefficients ??
    Array.from({ length: minSigners - 1 }, () => randomScalar());
  if (rest.length !== minSigners - 1) throw new Error("bad coefficient count");
  const coeffs = [mod(groupSecret), ...rest.map(mod)];
  const shares: KeyShare[] = [];
  for (let i = 1; i <= maxSigners; i++) {
    const id = BigInt(i);
    const s = evalPoly(coeffs, id);
    shares.push({ identifier: id, secretShare: s, publicShare: baseMul(s) });
  }
  return {
    groupPublicKey: baseMul(coeffs[0]!),
    threshold: minSigners,
    shares,
    vssCommitment: coeffs.map(baseMul),
  };
}

/** Feldman VSS check a participant runs on receipt of its share. */
export function vssVerify(share: KeyShare, vssCommitment: Point[]): boolean {
  let expected = Point.ZERO;
  let xPow = 1n;
  for (const C of vssCommitment) {
    expected = expected.add(pointMul(C, xPow));
    xPow = mod(xPow * share.identifier);
  }
  return expected.equals(baseMul(share.secretShare));
}

// ---------------------------------------------------------------------------
// Section 4 helpers
// ---------------------------------------------------------------------------

export function nonceGenerate(secret: bigint, randomness?: Uint8Array): bigint {
  const r = randomness ?? randomBytes(32);
  if (r.length !== 32) throw new Error("nonce randomness must be 32 bytes");
  return H3(concatBytes(r, serializeScalar(secret)));
}

export function deriveInterpolatingValue(L_: bigint[], xi: bigint): bigint {
  if (!L_.includes(xi)) throw new Error("invalid parameters");
  if (new Set(L_.map(String)).size !== L_.length) {
    throw new Error("invalid parameters");
  }
  let num = 1n;
  let den = 1n;
  for (const xj of L_) {
    if (xj === xi) continue;
    num = mod(num * xj);
    den = mod(den * (xj - xi));
  }
  return mod(num * invert(den));
}

export interface Commitment {
  identifier: bigint;
  hiding: Point; // D_i
  binding: Point; // E_i
}

function sortCommitments(list: Commitment[]): Commitment[] {
  return [...list].sort((a, b) =>
    a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0,
  );
}

export function encodeGroupCommitmentList(list: Commitment[]): Uint8Array {
  return concatBytes(
    ...sortCommitments(list).flatMap((c) => [
      serializeScalar(c.identifier),
      serializeElement(c.hiding),
      serializeElement(c.binding),
    ]),
  );
}

export function bindingFactorInput(
  groupPublicKey: Point,
  list: Commitment[],
  msg: Uint8Array,
  identifier: bigint,
): Uint8Array {
  return concatBytes(
    serializeElement(groupPublicKey),
    H4(msg),
    H5(encodeGroupCommitmentList(list)),
    serializeScalar(identifier),
  );
}

export function computeBindingFactors(
  groupPublicKey: Point,
  list: Commitment[],
  msg: Uint8Array,
): Map<bigint, bigint> {
  const out = new Map<bigint, bigint>();
  for (const c of sortCommitments(list)) {
    out.set(
      c.identifier,
      H1(bindingFactorInput(groupPublicKey, list, msg, c.identifier)),
    );
  }
  return out;
}

export function computeGroupCommitment(
  list: Commitment[],
  bindingFactors: Map<bigint, bigint>,
): Point {
  let R = Point.ZERO;
  for (const c of sortCommitments(list)) {
    const rho = bindingFactors.get(c.identifier);
    if (rho === undefined) throw new Error("invalid participant");
    R = R.add(c.hiding).add(pointMul(c.binding, rho));
  }
  return R;
}

export function computeChallenge(
  R: Point,
  groupPublicKey: Point,
  msg: Uint8Array,
): bigint {
  return H2(
    concatBytes(serializeElement(R), serializeElement(groupPublicKey), msg),
  );
}

// ---------------------------------------------------------------------------
// Section 5 — two-round signing
// ---------------------------------------------------------------------------

/**
 * Secret per-signing-session state. MUST be used for exactly one message and
 * then destroyed. Persisting, restoring or reusing it leaks the key share
 * (demonstrated in the test suite). This is the operational hazard of FROST.
 */
export interface SigningNonces {
  hiding: bigint; // d_i
  binding: bigint; // e_i
}

/** Round 1 (Section 5.1). Optional randomness is for test vectors only. */
export function commit(
  share: KeyShare,
  hidingRandomness?: Uint8Array,
  bindingRandomness?: Uint8Array,
): { nonces: SigningNonces; commitment: Commitment } {
  const hiding = nonceGenerate(share.secretShare, hidingRandomness);
  const binding = nonceGenerate(share.secretShare, bindingRandomness);
  return {
    nonces: { hiding, binding },
    commitment: {
      identifier: share.identifier,
      hiding: baseMul(hiding),
      binding: baseMul(binding),
    },
  };
}

/** Round 2 (Section 5.2): z_i = d_i + e_i*rho_i + lambda_i*s_i*c. */
export function signShare(
  share: KeyShare,
  nonces: SigningNonces,
  groupPublicKey: Point,
  list: Commitment[],
  msg: Uint8Array,
): bigint {
  const bf = computeBindingFactors(groupPublicKey, list, msg);
  const rho = bf.get(share.identifier);
  if (rho === undefined) throw new Error("signer not in commitment list");
  const R = computeGroupCommitment(list, bf);
  const ids = sortCommitments(list).map((c) => c.identifier);
  const lambda = deriveInterpolatingValue(ids, share.identifier);
  const c = computeChallenge(R, groupPublicKey, msg);
  return mod(
    nonces.hiding + nonces.binding * rho + lambda * share.secretShare * c,
  );
}

/** Coordinator-side share check (Section 5.4) — identifies a cheating signer. */
export function verifySignatureShare(
  identifier: bigint,
  publicShare: Point,
  sigShare: bigint,
  groupPublicKey: Point,
  list: Commitment[],
  msg: Uint8Array,
): boolean {
  const bf = computeBindingFactors(groupPublicKey, list, msg);
  const comm = list.find((c) => c.identifier === identifier);
  const rho = bf.get(identifier);
  if (!comm || rho === undefined) return false;
  const R = computeGroupCommitment(list, bf);
  const c = computeChallenge(R, groupPublicKey, msg);
  const ids = sortCommitments(list).map((x) => x.identifier);
  const lambda = deriveInterpolatingValue(ids, identifier);
  const lhs = baseMul(sigShare);
  const rhs = comm.hiding
    .add(pointMul(comm.binding, rho))
    .add(pointMul(publicShare, mod(c * lambda)));
  return lhs.equals(rhs);
}

/** Aggregate (Section 5.3): sig = SerializeElement(R) || SerializeScalar(sum z_i). */
export function aggregate(
  list: Commitment[],
  msg: Uint8Array,
  groupPublicKey: Point,
  sigShares: bigint[],
): Uint8Array {
  const bf = computeBindingFactors(groupPublicKey, list, msg);
  const R = computeGroupCommitment(list, bf);
  const z = sigShares.reduce((a, b) => mod(a + b), 0n);
  return concatBytes(serializeElement(R), serializeScalar(z));
}

/**
 * Convenience: run both rounds for a chosen signer subset in-process.
 * (In reality each signer runs on its own device and the coordinator only
 * sees commitments and shares.)
 */
export function signWithSubset(
  pkg: KeyPackage,
  signerIds: number[],
  msg: Uint8Array,
): Uint8Array {
  const signers = signerIds.map((id) => {
    const s = pkg.shares.find((x) => x.identifier === BigInt(id));
    if (!s) throw new Error(`unknown signer ${id}`);
    return s;
  });
  const round1 = signers.map((s) => ({ share: s, ...commit(s) }));
  const list = round1.map((r) => r.commitment);
  const shares = round1.map((r) =>
    signShare(r.share, r.nonces, pkg.groupPublicKey, list, msg),
  );
  return aggregate(list, msg, pkg.groupPublicKey, shares);
}

/** RFC 8032 cofactored check required by RFC 9591 §6.1: [8][z]B = [8]R + [8][c]PK. */
export function verifyCofactored(
  sig: Uint8Array,
  msg: Uint8Array,
  groupPublicKey: Point,
): boolean {
  if (sig.length !== 64) return false;
  try {
    const R = Point.fromBytes(sig.slice(0, 32));
    const z = deserializeScalar(sig.slice(32));
    const c = H2(concatBytes(sig.slice(0, 32), groupPublicKey.toBytes(), msg));
    const lhs = baseMul(z).clearCofactor();
    const rhs = R.add(pointMul(groupPublicKey, c)).clearCofactor();
    return lhs.equals(rhs);
  } catch {
    return false;
  }
}

export { Point, bytesToHex, hexToBytes };
