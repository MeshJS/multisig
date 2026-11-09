/**
 * Research PoC tests for issue #220 (FROST go/no-go).
 * See docs/research/frost-go-no-go.md and scripts/research/frost-ed25519/.
 *
 * Proves:
 *  - the PoC reproduces RFC 9591 Appendix E.1 (FROST(Ed25519, SHA-512)) byte-for-byte;
 *  - a t-of-n FROST signature verifies with a stock RFC 8032 verifier (noble);
 *  - it verifies as a Cardano vkey witness under the CSL fork Mesh ships
 *    (@meshsdk/core-csl → whisky-js), over a real tx body hash;
 *  - the group key hash works as a native-script `sig` leaf and an enterprise address;
 *  - fewer-than-threshold and tampered-message signatures fail;
 *  - nonce reuse leaks the signer's key share (the operational hazard).
 */
import { describe, expect, it } from "@jest/globals";
import { ed25519 } from "@noble/curves/ed25519";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";

import {
  aggregate,
  bindingFactorInput,
  bytesToHex,
  commit,
  computeBindingFactors,
  computeChallenge,
  computeGroupCommitment,
  hexToBytes,
  invert,
  deriveInterpolatingValue,
  mod,
  signShare,
  signWithSubset,
  trustedDealerKeygen,
  verifyCofactored,
  verifySignatureShare,
  vssVerify,
  type Commitment,
  type KeyPackage,
} from "../../scripts/research/frost-ed25519/frost";

const h = (s: string) => hexToBytes(s.replace(/\s+/g, ""));
const le = (s: string) => {
  // little-endian hex → bigint
  const b = h(s);
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
  return n;
};
const enc = (s: string) => new TextEncoder().encode(s);

// RFC 9591 Appendix E.1, FROST(Ed25519, SHA-512), copied from
// https://www.rfc-editor.org/rfc/rfc9591.txt
const V = {
  groupSecretKey:
    "7b1c33d3f5291d85de664833beb1ad469f7fb6025a0ec78b3a790c6e13a98304",
  groupPublicKey:
    "15d21ccd7ee42959562fc8aa63224c8851fb3ec85a3faf66040d380fb9738673",
  message: "74657374",
  coeff1: "178199860edd8c62f5212ee91eff1295d0d670ab4ed4506866bae57e7030b204",
  shares: {
    1: "929dcc590407aae7d388761cddb0c0db6f5627aea8e217f4a033f2ec83d93509",
    2: "a91e66e012e4364ac9aaa405fcafd370402d9859f7b6685c07eed76bf409e80d",
    3: "d3cb090a075eb154e82fdb4b3cb507f110040905468bb9c46da8bdea643a9a02",
  } as Record<number, string>,
  p1: {
    hidingRand:
      "0fd2e39e111cdc266f6c0f4d0fd45c947761f1f5d3cb583dfcb9bbaf8d4c9fec",
    bindingRand:
      "69cd85f631d5f7f2721ed5e40519b1366f340a87c2f6856363dbdcda348a7501",
    hidingNonce:
      "812d6104142944d5a55924de6d49940956206909f2acaeedecda2b726e630407",
    bindingNonce:
      "b1110165fc2334149750b28dd813a39244f315cff14d4e89e6142f262ed83301",
    hidingCommit:
      "b5aa8ab305882a6fc69cbee9327e5a45e54c08af61ae77cb8207be3d2ce13de3",
    bindingCommit:
      "67e98ab55aa310c3120418e5050c9cf76cf387cb20ac9e4b6fdb6f82a469f932",
    bfInput:
      "15d21ccd7ee42959562fc8aa63224c8851fb3ec85a3faf66040d380fb9738673504df914fa965023fb75c25ded4bb260f417de6d32e5c442c6ba313791cc9a4948d6273e8d3511f93348ea7a708a9b862bc73ba2a79cfdfe07729a193751cbc973af46d8ac3440e518d4ce440a0e7d4ad5f62ca8940f32de6d8dc00fc12c660b817d587d82f856d277ce6473cae6d2f5763f7da2e8b4d799a3f3e725d4522ec70100000000000000000000000000000000000000000000000000000000000000",
    bindingFactor:
      "f2cb9d7dd9beff688da6fcc83fa89046b3479417f47f55600b106760eb3b5603",
    sigShare:
      "001719ab5a53ee1a12095cd088fd149702c0720ce5fd2f29dbecf24b7281b603",
  },
  p3: {
    hidingRand:
      "86d64a260059e495d0fb4fcc17ea3da7452391baa494d4b00321098ed2a0062f",
    bindingRand:
      "13e6b25afb2eba51716a9a7d44130c0dbae0004a9ef8d7b5550c8a0e07c61775",
    hidingNonce:
      "c256de65476204095ebdc01bd11dc10e57b36bc96284595b8215222374f99c0e",
    bindingNonce:
      "243d71944d929063bc51205714ae3c2218bd3451d0214dfb5aeec2a90c35180d",
    hidingCommit:
      "cfbdb165bd8aad6eb79deb8d287bcc0ab6658ae57fdcc98ed12c0669e90aec91",
    bindingCommit:
      "7487bc41a6e712eea2f2af24681b58b1cf1da278ea11fe4e8b78398965f13552",
    bfInput:
      "15d21ccd7ee42959562fc8aa63224c8851fb3ec85a3faf66040d380fb9738673504df914fa965023fb75c25ded4bb260f417de6d32e5c442c6ba313791cc9a4948d6273e8d3511f93348ea7a708a9b862bc73ba2a79cfdfe07729a193751cbc973af46d8ac3440e518d4ce440a0e7d4ad5f62ca8940f32de6d8dc00fc12c660b817d587d82f856d277ce6473cae6d2f5763f7da2e8b4d799a3f3e725d4522ec70300000000000000000000000000000000000000000000000000000000000000",
    bindingFactor:
      "b087686bf35a13f3dc78e780a34b0fe8a77fef1b9938c563f5573d71d8d7890f",
    sigShare:
      "bd86125de990acc5e1f13781d8e32c03a9bbd4c53539bbc106058bfd14326007",
  },
  sig: "36282629c383bb820a88b71cae937d41f2f2adfcc3d02e55507e2fb9e2dd3cbebd9d2b0844e49ae0f3fa935161e1419aab7b47d21a37ebeae1f17d4987b3160b",
};

const scalarHex = (s: bigint) => {
  const out = new Uint8Array(32);
  let x = s;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return bytesToHex(out);
};

/** Build a minimal but real Cardano tx body and return its blake2b-256 hash. */
function realTxBodyHash(): Uint8Array {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(
      csl.TransactionHash.from_bytes(new Uint8Array(32)),
      0,
    ),
  );
  const outputs = csl.TransactionOutputs.new();
  const sink = csl.PrivateKey.generate_ed25519().to_public();
  outputs.add(
    csl.TransactionOutput.new(
      csl.EnterpriseAddress.new(
        0,
        csl.Credential.from_keyhash(sink.hash()),
      ).to_address(),
      csl.Value.new(csl.BigNum.from_str("1000000")),
    ),
  );
  const body = csl.TransactionBody.new(
    inputs,
    outputs,
    csl.BigNum.from_str("200000"),
    undefined,
  );
  const txHex = csl.Transaction.new(
    body,
    csl.TransactionWitnessSet.new(),
    undefined,
  ).to_hex();
  return hexToBytes(resolveTxHash(txHex));
}

describe("FROST(Ed25519, SHA-512) — RFC 9591 Appendix E.1 test vector", () => {
  const pkg: KeyPackage = trustedDealerKeygen(le(V.groupSecretKey), 3, 2, [
    le(V.coeff1),
  ]);
  const msg = h(V.message);

  it("reproduces group public key and all three participant shares", () => {
    expect(bytesToHex(pkg.groupPublicKey.toBytes())).toBe(V.groupPublicKey);
    for (const s of pkg.shares) {
      expect(scalarHex(s.secretShare)).toBe(V.shares[Number(s.identifier)]);
      expect(vssVerify(s, pkg.vssCommitment)).toBe(true);
    }
  });

  it("reproduces nonces, commitments, binding factors, sig shares and the final signature", () => {
    const p1 = pkg.shares[0]!;
    const p3 = pkg.shares[2]!;
    const r1 = commit(p1, h(V.p1.hidingRand), h(V.p1.bindingRand));
    const r3 = commit(p3, h(V.p3.hidingRand), h(V.p3.bindingRand));

    expect(scalarHex(r1.nonces.hiding)).toBe(V.p1.hidingNonce);
    expect(scalarHex(r1.nonces.binding)).toBe(V.p1.bindingNonce);
    expect(bytesToHex(r1.commitment.hiding.toBytes())).toBe(V.p1.hidingCommit);
    expect(bytesToHex(r1.commitment.binding.toBytes())).toBe(
      V.p1.bindingCommit,
    );
    expect(scalarHex(r3.nonces.hiding)).toBe(V.p3.hidingNonce);
    expect(scalarHex(r3.nonces.binding)).toBe(V.p3.bindingNonce);
    expect(bytesToHex(r3.commitment.hiding.toBytes())).toBe(V.p3.hidingCommit);
    expect(bytesToHex(r3.commitment.binding.toBytes())).toBe(
      V.p3.bindingCommit,
    );

    const list = [r1.commitment, r3.commitment];
    expect(
      bytesToHex(bindingFactorInput(pkg.groupPublicKey, list, msg, 1n)),
    ).toBe(V.p1.bfInput);
    expect(
      bytesToHex(bindingFactorInput(pkg.groupPublicKey, list, msg, 3n)),
    ).toBe(V.p3.bfInput);
    const bf = computeBindingFactors(pkg.groupPublicKey, list, msg);
    expect(scalarHex(bf.get(1n)!)).toBe(V.p1.bindingFactor);
    expect(scalarHex(bf.get(3n)!)).toBe(V.p3.bindingFactor);

    const z1 = signShare(p1, r1.nonces, pkg.groupPublicKey, list, msg);
    const z3 = signShare(p3, r3.nonces, pkg.groupPublicKey, list, msg);
    expect(scalarHex(z1)).toBe(V.p1.sigShare);
    expect(scalarHex(z3)).toBe(V.p3.sigShare);
    expect(
      verifySignatureShare(
        1n,
        p1.publicShare,
        z1,
        pkg.groupPublicKey,
        list,
        msg,
      ),
    ).toBe(true);
    expect(
      verifySignatureShare(
        3n,
        p3.publicShare,
        z3,
        pkg.groupPublicKey,
        list,
        msg,
      ),
    ).toBe(true);

    const sig = aggregate(list, msg, pkg.groupPublicKey, [z1, z3]);
    expect(bytesToHex(sig)).toBe(V.sig);
    // And the RFC vector itself is a plain Ed25519 signature.
    expect(ed25519.verify(sig, msg, pkg.groupPublicKey.toBytes())).toBe(true);
  });
});

describe.each([
  { t: 2, n: 3, signers: [1, 3], short: [2] },
  { t: 3, n: 5, signers: [2, 4, 5], short: [1, 3] },
])("FROST $t-of-$n", ({ t, n, signers, short }) => {
  const pkg = trustedDealerKeygen(
    mod(BigInt("0x" + bytesToHex(ed25519.utils.randomSecretKey()))),
    n,
    t,
  );
  const pk = pkg.groupPublicKey.toBytes();
  const txHash = realTxBodyHash();

  it("(a) aggregate signature verifies with a stock RFC 8032 verifier", () => {
    const sig = signWithSubset(pkg, signers, txHash);
    expect(sig).toHaveLength(64);
    expect(ed25519.verify(sig, txHash, pk)).toBe(true);
    expect(verifyCofactored(sig, txHash, pkg.groupPublicKey)).toBe(true);
    // Any other qualifying subset produces a (different) valid signature.
    const other = Array.from({ length: n }, (_, i) => i + 1).slice(-t);
    expect(ed25519.verify(signWithSubset(pkg, other, txHash), txHash, pk)).toBe(
      true,
    );
  });

  it("(b) is accepted as a Cardano vkey witness by the CSL fork Mesh ships", () => {
    const sig = signWithSubset(pkg, signers, txHash);
    const cslPk = csl.PublicKey.from_bytes(pk);
    const cslSig = csl.Ed25519Signature.from_bytes(sig);
    expect(cslPk.verify(txHash, cslSig)).toBe(true);

    const witness = csl.Vkeywitness.new(csl.Vkey.new(cslPk), cslSig);
    const roundTrip = csl.Vkeywitness.from_bytes(witness.to_bytes());
    expect(
      roundTrip.vkey().public_key().verify(txHash, roundTrip.signature()),
    ).toBe(true);
    // One ordinary witness: 0x82 array, 32-byte vkey, 64-byte sig = 101 bytes.
    expect(witness.to_bytes()).toHaveLength(101);
  });

  it("(b) group key hash works as a native-script sig leaf and an enterprise address", () => {
    const keyHash = csl.PublicKey.from_bytes(pk).hash();
    expect(keyHash.to_bytes()).toHaveLength(28);

    const enterprise = csl.EnterpriseAddress.new(
      0,
      csl.Credential.from_keyhash(keyHash),
    )
      .to_address()
      .to_bech32(undefined);
    expect(enterprise.startsWith("addr_test1v")).toBe(true);

    // Hybrid: FROST group key as ONE leaf of a 2-of-3 native script alongside two ordinary keys.
    const leaves = csl.NativeScripts.new();
    leaves.add(
      csl.NativeScript.new_script_pubkey(csl.ScriptPubkey.new(keyHash)),
    );
    for (let i = 0; i < 2; i++) {
      const k = csl.PrivateKey.generate_ed25519().to_public().hash();
      leaves.add(csl.NativeScript.new_script_pubkey(csl.ScriptPubkey.new(k)));
    }
    const script = csl.NativeScript.new_script_n_of_k(
      csl.ScriptNOfK.new(2, leaves),
    );
    const required = script.get_required_signers();
    const hexes = Array.from({ length: required.len() }, (_, i) =>
      required.get(i).to_hex(),
    );
    expect(hexes).toContain(keyHash.to_hex());
    expect(script.hash().to_bytes()).toHaveLength(28);
  });

  it("(c) fewer than threshold shares cannot produce a valid signature", () => {
    // Interpolating over t-1 shares yields the wrong secret; the result is a
    // well-formed but invalid signature.
    const sub = short.map((id) => pkg.shares[id - 1]!);
    const r = sub.map((s) => ({ s, ...commit(s) }));
    const list = r.map((x) => x.commitment);
    const z = r.map((x) =>
      signShare(x.s, x.nonces, pkg.groupPublicKey, list, txHash),
    );
    const sig = aggregate(list, txHash, pkg.groupPublicKey, z);
    expect(ed25519.verify(sig, txHash, pk)).toBe(false);
    expect(
      csl.PublicKey.from_bytes(pk).verify(
        txHash,
        csl.Ed25519Signature.from_bytes(sig),
      ),
    ).toBe(false);
  });

  it("(c) a tampered message fails verification", () => {
    const sig = signWithSubset(pkg, signers, txHash);
    const tampered = txHash.slice();
    tampered[0] = tampered[0]! ^ 0x01;
    expect(ed25519.verify(sig, tampered, pk)).toBe(false);
    expect(
      csl.PublicKey.from_bytes(pk).verify(
        tampered,
        csl.Ed25519Signature.from_bytes(sig),
      ),
    ).toBe(false);
  });
});

describe("FROST operational hazard — nonce reuse leaks the key share", () => {
  it("three signatures under one nonce pair let a malicious coordinator solve for s_i", () => {
    const pkg = trustedDealerKeygen(mod(123456789n), 3, 2);
    const victim = pkg.shares[0]!;
    const honest = pkg.shares[1]!;
    const { nonces, commitment } = commit(victim); // victim restores this state 3x
    const ids = [victim.identifier, honest.identifier];
    const lambda = deriveInterpolatingValue(ids, victim.identifier);

    // Coordinator varies the message; victim answers each with the same (d, e).
    const rows: [bigint, bigint, bigint, bigint][] = [];
    for (const m of ["pay 1", "pay 2", "pay 3"]) {
      const msg = enc(m);
      const list: Commitment[] = [commitment, commit(honest).commitment];
      const z = signShare(victim, nonces, pkg.groupPublicKey, list, msg);
      const bf = computeBindingFactors(pkg.groupPublicKey, list, msg);
      const R = computeGroupCommitment(list, bf);
      const c = computeChallenge(R, pkg.groupPublicKey, msg);
      // z = 1*d + rho*e + c*(lambda*s)
      rows.push([1n, bf.get(victim.identifier)!, c, z]);
    }

    // Solve the 3x3 linear system mod L (Cramer) for x = lambda*s.
    const det3 = (m: bigint[][]) =>
      mod(
        m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
          m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
          m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!),
      );
    const A = rows.map((r) => [r[0], r[1], r[2]]);
    const Ax = rows.map((r) => [r[0], r[1], r[3]]);
    const x = mod(det3(Ax) * invert(det3(A)));
    const recovered = mod(x * invert(lambda));

    expect(recovered).toBe(victim.secretShare);
  });
});
