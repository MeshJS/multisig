import { describe, expect, it } from "@jest/globals";
import { resolvePoolId } from "@meshsdk/core";
import { normalizePoolIdForDelegation } from "@/lib/server/normalizePoolId";

describe("normalizePoolIdForDelegation", () => {
  it("normalizes 56-char hex", () => {
    const hex = "0".repeat(56);
    expect(normalizePoolIdForDelegation(hex)).toBe(resolvePoolId(hex));
  });
});
