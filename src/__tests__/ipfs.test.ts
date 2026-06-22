import { describe, expect, it, jest } from "@jest/globals";

// extractCidPath is pure, but the module imports the validated env object.
jest.mock("@/env", () => ({ env: {} }));

import { extractCidPath } from "@/lib/ipfs";

const CID = "QmTzQ1Nj5wW3sM1f8Z9d4VqLp2rXh7Yk6BcDeFgHiJkLm";

describe("extractCidPath", () => {
  it("returns a bare CID unchanged", () => {
    expect(extractCidPath(CID)).toBe(CID);
  });

  it("strips the ipfs:// scheme (with or without an ipfs/ prefix)", () => {
    expect(extractCidPath(`ipfs://${CID}`)).toBe(CID);
    expect(extractCidPath(`ipfs://ipfs/${CID}`)).toBe(CID);
  });

  it("extracts cid[/path] after /ipfs/ in a gateway URL", () => {
    expect(extractCidPath(`https://gateway.pinata.cloud/ipfs/${CID}`)).toBe(CID);
    expect(extractCidPath(`https://x.mypinata.cloud/ipfs/${CID}/meta.json`)).toBe(
      `${CID}/meta.json`,
    );
  });

  it("matches the /ipfs/ marker case-insensitively", () => {
    expect(extractCidPath(`https://x/IPFS/${CID}`)).toBe(CID);
  });

  it("drops query/hash and leading slashes", () => {
    expect(extractCidPath(`https://x/ipfs/${CID}?foo=1#bar`)).toBe(CID);
    expect(extractCidPath(`/ipfs/${CID}`)).toBe(CID);
  });

  it("returns null for empty, non-ipfs, too-short, or traversal inputs", () => {
    expect(extractCidPath("")).toBeNull();
    expect(extractCidPath(null)).toBeNull();
    expect(extractCidPath(undefined)).toBeNull();
    expect(extractCidPath("https://example.com/foo")).toBeNull();
    expect(extractCidPath("short")).toBeNull();
    expect(extractCidPath(`https://x/ipfs/${CID}/../secret`)).toBeNull();
  });

  it("terminates quickly on hostile repeated /ipfs/ input (no ReDoS)", () => {
    const hostile = "/ipfs/a".repeat(20000);
    const start = Date.now();
    const result = extractCidPath(hostile);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result).toBeNull();
  });
});
