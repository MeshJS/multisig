// Generates the Ed25519 keypair used to attest document versions.
//
// Run with:  node scripts/generate-attestation-key.mjs
//
// The private half goes in DOCUMENT_ATTESTATION_KEY. The public half is safe to
// publish and is what lets anyone verify a document's attestation chain without
// this app — print it, commit it to a status page, hand it to an auditor.
//
// This key is a NOTARY, not an approver. It signs "this version existed at this
// time, in this position"; it cannot approve a document and cannot witness a
// transaction. See src/lib/documents/attestation.ts for the full threat model.
//
// TO ROTATE: generate a new key, move the OLD public key into
// DOCUMENT_ATTESTATION_PRIOR_PUBLIC_KEYS as {"<keyId>":"<publicKeyHex>"} so
// history signed by it keeps verifying, then set the new private key.
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");

const privateBase64 = privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64");

const publicKeyHex = createPublicKey(privateKey)
  .export({ type: "spki", format: "der" })
  .toString("hex");

const keyId = createHash("sha256")
  .update(publicKeyHex, "utf8")
  .digest("hex")
  .slice(0, 16);

console.log(`
Document attestation keypair
============================

key id      ${keyId}
public key  ${publicKeyHex}

Set this on the server (Railway variable, .env locally) and keep it secret:

DOCUMENT_ATTESTATION_KEY=${privateBase64}

Publish the public key and key id above so attestation chains can be verified
without this app. Rotating? Keep the previous public key verifiable:

DOCUMENT_ATTESTATION_PRIOR_PUBLIC_KEYS={"<old key id>":"<old public key hex>"}
`);
