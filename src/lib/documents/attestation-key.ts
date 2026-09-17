import { createPrivateKey, createPublicKey, type KeyObject } from "crypto";

import { env } from "@/env";

import {
  attestationKeyId,
  signAttestation,
  type AttestationPayload,
} from "./attestation";

/**
 * Server-side custody of the attestation key.
 *
 * Kept apart from `attestation.ts` so that module stays dependency-free and
 * offline-verifiable: a third party checking a proof needs the algorithms, not
 * this app's environment.
 *
 * THREAT MODEL, STATED PLAINLY
 *
 * This is the only private key the platform holds, and it is deliberately the
 * least powerful one it could hold. It signs statements that a version existed
 * at a time and in an order. It cannot approve a document — approval requires
 * CIP-8 signatures from the wallet's own signers against a frozen snapshot —
 * and it cannot witness a transaction, so it cannot move funds. An attacker who
 * steals it can forge and reorder timestamps, which corrupts the audit trail
 * and nothing else, and even then only for chains a verifier still accepts the
 * stolen key for: rotate it out of `DOCUMENT_ATTESTATION_KEY`, leave its public
 * half in `DOCUMENT_ATTESTATION_PRIOR_PUBLIC_KEYS`, and new forgeries under it
 * are refused while genuine history keeps verifying.
 *
 * Attestation is OPTIONAL. With no key configured every other part of Document
 * Sign-Off works exactly as before — versions simply carry no attestation. A
 * missing key must never be able to block someone from creating or approving a
 * document.
 */

export interface AttestationSigner {
  keyId: string;
  /** SPKI DER hex — the form an offline verifier consumes. */
  publicKeySpkiHex: string;
  sign(payload: AttestationPayload): string;
}

type Loaded = {
  signer: AttestationSigner | null;
  publicKeys: Record<string, string>;
};

let loaded: Loaded | null = null;

function parsePriorKeys(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Record<string, string> = {};
    for (const [keyId, hex] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof hex === "string" && /^[0-9a-f]+$/i.test(hex)) {
        out[keyId] = hex.toLowerCase();
      }
    }
    return out;
  } catch {
    // A malformed registry must not take the app down. Old chains signed by a
    // key that is no longer listed will fail verification loudly, which is the
    // correct and visible outcome.
    return {};
  }
}

function load(): Loaded {
  if (loaded) return loaded;

  const publicKeys = parsePriorKeys(env.DOCUMENT_ATTESTATION_PRIOR_PUBLIC_KEYS);
  const raw = env.DOCUMENT_ATTESTATION_KEY;

  if (!raw) {
    loaded = { signer: null, publicKeys };
    return loaded;
  }

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(raw, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    // Same reasoning as above: a bad key disables attestation rather than
    // breaking document creation.
    loaded = { signer: null, publicKeys };
    return loaded;
  }

  if (privateKey.asymmetricKeyType !== "ed25519") {
    loaded = { signer: null, publicKeys };
    return loaded;
  }

  const publicKeySpkiHex = createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .toString("hex");
  const keyId = attestationKeyId(publicKeySpkiHex);

  loaded = {
    signer: {
      keyId,
      publicKeySpkiHex,
      sign: (payload) => signAttestation(payload, privateKey),
    },
    publicKeys: { ...publicKeys, [keyId]: publicKeySpkiHex },
  };
  return loaded;
}

/** The active signer, or null when attestation is not configured. */
export function getAttestationSigner(): AttestationSigner | null {
  return load().signer;
}

/**
 * Every public key a verifier should accept: the active one plus any retired
 * ones. Safe to publish — this is what makes a chain checkable without us.
 */
export function getAttestationPublicKeys(): Record<string, string> {
  return { ...load().publicKeys };
}

/** Test seam. */
export function resetAttestationKeyCache(): void {
  loaded = null;
}
