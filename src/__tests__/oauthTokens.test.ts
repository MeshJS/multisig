import { beforeAll, describe, expect, it } from "@jest/globals";
import { createHash, randomBytes } from "crypto";

import {
  isValidCodeChallenge,
  isValidCodeVerifier,
  verifyCodeChallenge,
} from "@/lib/oauth/pkce";
import {
  isAcceptableRedirectUri,
  isMetadataUrlClientId,
  redirectUriMatches,
} from "@/lib/oauth/redirects";
import { ACCESS_TOKEN_TYPE, mintAccessToken, verifyAccessToken } from "@/lib/oauth/accessToken";
import { verifyJwt } from "@/lib/verifyJwt";

const ISSUER = "https://multisig.example";
const RESOURCE = `${ISSUER}/api/mcp`;

beforeAll(() => {
  process.env.JWT_SECRET ??= "test-secret-that-is-at-least-32-chars-long";
});

const challengeFor = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

describe("PKCE", () => {
  const verifier = randomBytes(32).toString("base64url");

  it("accepts a matching S256 verifier", () => {
    expect(verifyCodeChallenge(verifier, challengeFor(verifier))).toBe(true);
  });

  it("rejects a non-matching verifier", () => {
    const other = randomBytes(32).toString("base64url");
    expect(verifyCodeChallenge(other, challengeFor(verifier))).toBe(false);
  });

  it("rejects a plain (unhashed) challenge", () => {
    // OAuth 2.1 removes the `plain` method. If this ever passes, anyone who
    // intercepts an authorization code can redeem it.
    expect(verifyCodeChallenge(verifier, verifier)).toBe(false);
  });

  it("enforces the RFC 7636 verifier charset and length", () => {
    expect(isValidCodeVerifier("short")).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier(`${"a".repeat(42)}!`)).toBe(false);
  });

  it("validates challenge shape", () => {
    expect(isValidCodeChallenge(challengeFor(verifier))).toBe(true);
    expect(isValidCodeChallenge("too-short")).toBe(false);
    // base64url has no padding
    expect(isValidCodeChallenge(`${"a".repeat(42)}=`)).toBe(false);
  });
});

describe("redirect URI matching", () => {
  it("requires an exact match for https redirects", () => {
    expect(
      redirectUriMatches("https://app.example/cb", "https://app.example/cb"),
    ).toBe(true);
    expect(
      redirectUriMatches("https://app.example/cb", "https://app.example/other"),
    ).toBe(false);
    expect(
      redirectUriMatches("https://app.example/cb", "https://evil.example/cb"),
    ).toBe(false);
  });

  it("ignores the port for loopback redirects (RFC 8252)", () => {
    // Native clients bind an ephemeral port at runtime; Claude Code registers
    // http://127.0.0.1/callback and then listens on a random port.
    expect(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:51763/callback"),
    ).toBe(true);
    expect(
      redirectUriMatches("http://localhost/callback", "http://localhost:8080/callback"),
    ).toBe(true);
  });

  it("does not let the loopback carve-out cross hosts or paths", () => {
    expect(
      redirectUriMatches("http://127.0.0.1/callback", "http://localhost:80/callback"),
    ).toBe(false);
    expect(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:8080/evil"),
    ).toBe(false);
    // The carve-out must not extend to non-loopback hosts.
    expect(
      redirectUriMatches("http://app.example/cb", "http://app.example:8080/cb"),
    ).toBe(false);
  });
});

describe("redirect URI scheme validation", () => {
  // This guard originally lived only inside the DCR handler, which left the
  // CIMD path accepting any string. A `javascript:` URI registered that way
  // matches itself in redirectUriMatches and ends up at window.location.href on
  // the consent page — script execution on the app origin, with no CSP to stop
  // it. Every registration path must run this.
  it("rejects dangerous schemes", () => {
    expect(isAcceptableRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAcceptableRedirectUri("javascript:fetch('https://evil')//")).toBe(false);
    expect(isAcceptableRedirectUri("data:text/html,<script>1</script>")).toBe(false);
    expect(isAcceptableRedirectUri("vbscript:msgbox")).toBe(false);
    expect(isAcceptableRedirectUri("file:///etc/passwd")).toBe(false);
    expect(isAcceptableRedirectUri("not a url")).toBe(false);
  });

  it("rejects plaintext http to a non-loopback host", () => {
    // Authorization codes must not travel in cleartext to an arbitrary host.
    expect(isAcceptableRedirectUri("http://evil.example/cb")).toBe(false);
  });

  it("rejects a URI carrying a fragment", () => {
    expect(isAcceptableRedirectUri("https://app.example/cb#frag")).toBe(false);
  });

  it("accepts https and loopback http", () => {
    expect(isAcceptableRedirectUri("https://app.example/cb")).toBe(true);
    expect(isAcceptableRedirectUri("http://127.0.0.1:8080/callback")).toBe(true);
    expect(isAcceptableRedirectUri("http://localhost/callback")).toBe(true);
  });
});

describe("client id metadata documents", () => {
  it("recognises an https URL with a path", () => {
    expect(isMetadataUrlClientId("https://claude.ai/oauth/client-metadata")).toBe(true);
  });

  it("rejects non-https or path-less ids", () => {
    expect(isMetadataUrlClientId("http://claude.ai/oauth/meta")).toBe(false);
    expect(isMetadataUrlClientId("https://claude.ai")).toBe(false);
    expect(isMetadataUrlClientId("mcp-1234")).toBe(false);
  });

  it("rejects a non-default port (SSRF port pinning) but accepts :443", () => {
    // The CIMD fetch is an SSRF sink; an explicit port would let a client_id
    // probe arbitrary services on any public host.
    expect(isMetadataUrlClientId("https://claude.ai:8443/oauth/meta")).toBe(false);
    // URL normalises ":443" to the default, so this stays acceptable.
    expect(isMetadataUrlClientId("https://claude.ai:443/oauth/meta")).toBe(true);
  });
});

describe("access tokens", () => {
  const mint = (over: Partial<Parameters<typeof mintAccessToken>[0]> = {}) =>
    mintAccessToken({
      issuer: ISSUER,
      resource: RESOURCE,
      subject: "addr_test1qpuser",
      clientId: "mcp-client",
      scopes: ["wallets:read"],
      addresses: ["addr_test1qpuser"],
      ...over,
    }).token;

  it("round-trips subject, scopes and addresses", () => {
    const verified = verifyAccessToken(mint(), { issuer: ISSUER, resource: RESOURCE });
    expect(verified).toMatchObject({
      subject: "addr_test1qpuser",
      clientId: "mcp-client",
      scopes: ["wallets:read"],
      addresses: ["addr_test1qpuser"],
    });
  });

  it("rejects a token minted for a different resource (RFC 8707)", () => {
    // The MCP spec states this as a MUST: a token valid for another resource
    // must not be accepted here, even with a good signature from this issuer.
    const token = mint({ resource: "https://other.example/api/mcp" });
    expect(verifyAccessToken(token, { issuer: ISSUER, resource: RESOURCE })).toBeNull();
  });

  it("rejects a token from a different issuer", () => {
    const token = mint({ issuer: "https://evil.example" });
    expect(verifyAccessToken(token, { issuer: ISSUER, resource: RESOURCE })).toBeNull();
  });

  describe("isolation from v1 bearer tokens", () => {
    // Both families are signed with JWT_SECRET, so they must be distinguishable
    // by claims alone or one could be replayed as the other.
    it("is not accepted by the v1 JWT verifier", () => {
      expect(verifyJwt(mint())).toBeNull();
    });

    it("does not accept a v1 human JWT", () => {
      const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
      const v1Token = jwt.sign(
        { address: "addr_test1qpuser" },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" },
      );
      expect(verifyAccessToken(v1Token, { issuer: ISSUER, resource: RESOURCE })).toBeNull();
    });

    it("does not accept a v1 bot JWT", () => {
      const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
      const botToken = jwt.sign(
        { address: "addr_test1qpbot", botId: "bot-1", type: "bot" },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" },
      );
      expect(verifyAccessToken(botToken, { issuer: ISSUER, resource: RESOURCE })).toBeNull();
    });

    it("declares the discriminating type claim", () => {
      expect(ACCESS_TOKEN_TYPE).toBe("mcp_at");
    });
  });
});
