import { describe, expect, it } from "@jest/globals";
import jwt from "jsonwebtoken";

import {
  DRAFT_TOKEN_TTL_SECONDS,
  DRAFT_TOKEN_TYPE,
  mintDraftToken,
  verifyDraftToken,
} from "@/lib/tx-review/draft-token";
import type { TxSpec } from "@/lib/tx-review/spec";
import { mintAccessToken, verifyAccessToken } from "@/lib/oauth/accessToken";
import { verifyJwt } from "@/lib/verifyJwt";

/**
 * The draft token is what makes preview→confirm safe: propose accepts nothing
 * else, so the created transaction is exactly the reviewed one. These tests
 * pin the binding (subject, client, spec, preview hash), the expiry, and the
 * non-interchangeability with the other two token families that share
 * JWT_SECRET.
 */

const SUBJECT = "addr_test1qpsubject";
const CLIENT = "https://claude.ai/x";

const spec: TxSpec = {
  v: 1,
  walletId: "wallet-1",
  outputs: [{ address: "addr_test1qprecipient", assets: [{ unit: "lovelace", quantity: "12500000" }] }],
  certificates: [],
  votes: [],
  description: "Pay Alice",
  metadataMessage: "",
};

function mint(overrides: Partial<Parameters<typeof mintDraftToken>[0]> = {}) {
  return mintDraftToken({
    subject: SUBJECT,
    walletId: "wallet-1",
    clientId: CLIENT,
    spec,
    previewTxHash: "ab".repeat(32),
    ...overrides,
  });
}

describe("draft token", () => {
  it("round-trips the reviewed draft for the same caller", () => {
    const { token, jti, expiresAt } = mint();
    const result = verifyDraftToken(token, { subject: SUBJECT, clientId: CLIENT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.jti).toBe(jti);
    expect(result.claims.walletId).toBe("wallet-1");
    expect(result.claims.spec).toEqual(spec);
    expect(result.claims.previewTxHash).toBe("ab".repeat(32));
    expect(result.claims.expiresAt).toBe(expiresAt);
    // Fifteen minutes: long enough to read a card, short enough that the
    // UTxO set it was built against is still roughly current.
    expect(expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(DRAFT_TOKEN_TTL_SECONDS);
    expect(DRAFT_TOKEN_TTL_SECONDS).toBe(900);
  });

  it("gives every mint a fresh id", () => {
    expect(mint().jti).not.toBe(mint().jti);
  });

  it("rejects a token issued to another address", () => {
    const { token } = mint();
    const result = verifyDraftToken(token, { subject: "addr_test1qpother", clientId: CLIENT });
    expect(result).toEqual({ ok: false, reason: "subject_mismatch" });
  });

  it("rejects a token issued to another MCP client, even for the same human", () => {
    const { token } = mint();
    const result = verifyDraftToken(token, { subject: SUBJECT, clientId: "https://other.example" });
    expect(result).toEqual({ ok: false, reason: "client_mismatch" });
  });

  it("treats a null client (v1 bearer) as its own client identity", () => {
    const { token } = mint({ clientId: null });
    expect(verifyDraftToken(token, { subject: SUBJECT, clientId: null }).ok).toBe(true);
    expect(verifyDraftToken(token, { subject: SUBJECT, clientId: CLIENT })).toEqual({
      ok: false,
      reason: "client_mismatch",
    });
  });

  it("rejects a tampered payload", () => {
    const { token } = mint();
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        typ: DRAFT_TOKEN_TYPE,
        sub: SUBJECT,
        wid: "wallet-1",
        cid: CLIENT,
        spec: { ...spec, outputs: [{ address: "addr_test1qpattacker", assets: spec.outputs[0]!.assets }] },
        ph: "ab".repeat(32),
        jti: "x",
        iat: 1,
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString("base64url");
    const result = verifyDraftToken(`${header}.${forged}.${signature}`, {
      subject: SUBJECT,
      clientId: CLIENT,
    });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an expired token with a distinct reason", () => {
    const token = jwt.sign(
      { typ: DRAFT_TOKEN_TYPE, sub: SUBJECT, wid: "wallet-1", cid: CLIENT, spec, ph: "00", jti: "j" },
      process.env.JWT_SECRET as string,
      { expiresIn: -10 },
    );
    expect(verifyDraftToken(token, { subject: SUBJECT, clientId: CLIENT })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("carries a task origin through, and reports none for a hand-composed draft", () => {
    const origin = { kind: "tasks" as const, taskIds: ["t1", "t2"], recipientsHash: "ab".repeat(32) };
    const withOrigin = verifyDraftToken(mint({ origin }).token, { subject: SUBJECT, clientId: CLIENT });
    expect(withOrigin.ok && withOrigin.claims.origin).toEqual(origin);

    const without = verifyDraftToken(mint().token, { subject: SUBJECT, clientId: CLIENT });
    expect(without.ok && without.claims.origin).toBeNull();
  });

  it("rejects a malformed origin as malformed", () => {
    // A signed token from this server always has a well-formed origin, so a
    // bad one can only come from another signer — refuse it outright.
    const token = jwt.sign(
      {
        typ: DRAFT_TOKEN_TYPE,
        sub: SUBJECT,
        wid: "wallet-1",
        cid: CLIENT,
        spec,
        ph: "00",
        jti: "j",
        origin: { kind: "tasks", taskIds: [], recipientsHash: "" },
      },
      process.env.JWT_SECRET as string,
      { expiresIn: 60 },
    );
    expect(verifyDraftToken(token, { subject: SUBJECT, clientId: CLIENT })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("is not an OAuth access token, and an access token is not a draft", () => {
    const { token: draft } = mint();
    expect(
      verifyAccessToken(draft, { issuer: "http://localhost:3000", resource: "http://localhost:3000/api/mcp" }),
    ).toBeNull();
    // Nor a v1 bearer: no `address` claim.
    expect(verifyJwt(draft)).toBeNull();

    const { token: access } = mintAccessToken({
      issuer: "http://localhost:3000",
      resource: "http://localhost:3000/api/mcp",
      subject: SUBJECT,
      clientId: CLIENT,
      scopes: ["transactions:write"],
      addresses: [SUBJECT],
    });
    expect(verifyDraftToken(access, { subject: SUBJECT, clientId: CLIENT })).toEqual({
      ok: false,
      reason: "wrong_type",
    });
  });
});
