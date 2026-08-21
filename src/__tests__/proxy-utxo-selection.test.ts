import { describe, it, expect } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import {
  selectProxyUtxosForOutputs,
  selectAuthTokenUtxo,
  selectSetupUtxo,
  accumulateFundingUtxos,
} from "@/lib/proxy/utxoUtils";

const AUTH_POLICY_ID = "a".repeat(56);
const TOKEN_UNIT = "d".repeat(56) + "6d79546f6b656e";

function mkUtxo(
  txHash: string,
  outputIndex: number,
  lovelace: string,
  token?: { unit: string; quantity: string },
): UTxO {
  return {
    input: { txHash, outputIndex },
    output: {
      address: "addr_test1_proxy",
      amount: token
        ? [{ unit: "lovelace", quantity: lovelace }, token]
        : [{ unit: "lovelace", quantity: lovelace }],
    },
  };
}

// ─── selectProxyUtxosForOutputs ───────────────────────────────────────────────

describe("selectProxyUtxosForOutputs", () => {
  it("returns the single UTxO that exactly covers the required amount", () => {
    const utxo = mkUtxo("a".repeat(64), 0, "2000000");
    const selected = selectProxyUtxosForOutputs([utxo], [{ unit: "lovelace", amount: "2000000" }]);
    expect(selected).toEqual([utxo]);
  });

  it("greedily selects the single large UTxO instead of two smaller ones", () => {
    const small = mkUtxo("a".repeat(64), 0, "1000000");
    const large = mkUtxo("b".repeat(64), 0, "5000000");
    // 3 ADA required — large alone covers it; small alone does not
    const selected = selectProxyUtxosForOutputs(
      [small, large],
      [{ unit: "lovelace", amount: "3000000" }],
    );
    expect(selected).toEqual([large]);
  });

  it("selects multiple UTxOs when feeBuffer pushes total above a single UTxO", () => {
    const a = mkUtxo("a".repeat(64), 0, "1500000");
    const b = mkUtxo("b".repeat(64), 0, "1500000");
    // 1.5 ADA output + 0.5 ADA fee buffer = 2.0 ADA required; each UTxO is 1.5 ADA
    const selected = selectProxyUtxosForOutputs(
      [a, b],
      [{ unit: "lovelace", amount: "1500000" }],
      500_000n,
    );
    expect(selected).toHaveLength(2);
    expect(selected).toContain(a);
    expect(selected).toContain(b);
  });

  it("handles multi-asset outputs by selecting the UTxO holding the token", () => {
    const lovelaceOnly = mkUtxo("a".repeat(64), 0, "5000000");
    const withToken = mkUtxo("b".repeat(64), 0, "2000000", { unit: TOKEN_UNIT, quantity: "1" });
    const selected = selectProxyUtxosForOutputs(
      [lovelaceOnly, withToken],
      [{ unit: TOKEN_UNIT, amount: "1" }],
    );
    expect(selected).toContain(withToken);
    expect(selected).not.toContain(lovelaceOnly);
  });

  it("selects both a lovelace UTxO and a token UTxO when both are needed", () => {
    const lovelaceUtxo = mkUtxo("a".repeat(64), 0, "3000000");
    const tokenUtxo = mkUtxo("b".repeat(64), 0, "2000000", { unit: TOKEN_UNIT, quantity: "1" });
    const outputs = [
      { unit: "lovelace", amount: "3000000" },
      { unit: TOKEN_UNIT, amount: "1" },
    ];
    const selected = selectProxyUtxosForOutputs([lovelaceUtxo, tokenUtxo], outputs);
    expect(selected).toContain(lovelaceUtxo);
    expect(selected).toContain(tokenUtxo);
  });

  it("throws when proxy balance is insufficient to cover outputs", () => {
    const utxo = mkUtxo("a".repeat(64), 0, "1000000");
    expect(() =>
      selectProxyUtxosForOutputs([utxo], [{ unit: "lovelace", amount: "5000000" }]),
    ).toThrow("Unable to select proxy UTxOs for requested outputs");
  });

  it("throws when the token is not held by any proxy UTxO", () => {
    const utxo = mkUtxo("a".repeat(64), 0, "5000000");
    expect(() =>
      selectProxyUtxosForOutputs([utxo], [{ unit: TOKEN_UNIT, amount: "1" }]),
    ).toThrow("Unable to select proxy UTxOs for requested outputs");
  });
});

// ─── selectAuthTokenUtxo ──────────────────────────────────────────────────────

describe("selectAuthTokenUtxo", () => {
  it("returns the UTxO that holds the auth token", () => {
    const noToken = mkUtxo("a".repeat(64), 0, "5000000");
    const withToken = mkUtxo("b".repeat(64), 0, "2000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const result = selectAuthTokenUtxo([noToken, withToken], AUTH_POLICY_ID);
    expect(result).toEqual(withToken);
  });

  it("prefers the UTxO with more lovelace when multiple candidates exist", () => {
    const rich = mkUtxo("a".repeat(64), 0, "10000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const poor = mkUtxo("b".repeat(64), 0, "2000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const result = selectAuthTokenUtxo([poor, rich], AUTH_POLICY_ID);
    expect(result).toEqual(rich);
  });

  it("breaks lovelace ties by lexicographic txHash order", () => {
    const first = mkUtxo("a".repeat(64), 0, "5000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const second = mkUtxo("b".repeat(64), 0, "5000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const result = selectAuthTokenUtxo([second, first], AUTH_POLICY_ID);
    expect(result).toEqual(first); // "aaa..." < "bbb..."
  });

  it("skips UTxOs listed in blockedUtxoRefs", () => {
    const blocked = mkUtxo("a".repeat(64), 0, "10000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const free = mkUtxo("b".repeat(64), 0, "2000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const result = selectAuthTokenUtxo(
      [blocked, free],
      AUTH_POLICY_ID,
      [{ txHash: "a".repeat(64), outputIndex: 0 }],
    );
    expect(result).toEqual(free);
  });

  it("throws when no auth token UTxO is available", () => {
    const noToken = mkUtxo("a".repeat(64), 0, "5000000");
    expect(() => selectAuthTokenUtxo([noToken], AUTH_POLICY_ID)).toThrow(
      "No AuthToken found",
    );
  });

  it("throws when all auth token UTxOs are blocked", () => {
    const utxo = mkUtxo("a".repeat(64), 0, "5000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    expect(() =>
      selectAuthTokenUtxo(
        [utxo],
        AUTH_POLICY_ID,
        [{ txHash: "a".repeat(64), outputIndex: 0 }],
      ),
    ).toThrow("No AuthToken found");
  });
});

// ─── selectSetupUtxo ──────────────────────────────────────────────────────────

describe("selectSetupUtxo", () => {
  it("returns the first UTxO with at least 20 ADA", () => {
    const utxo = mkUtxo("a".repeat(64), 0, "20000000");
    const result = selectSetupUtxo([utxo]);
    expect(result).toEqual(utxo);
  });

  it("returns null when no UTxO has 20 ADA", () => {
    const small = mkUtxo("a".repeat(64), 0, "5000000");
    const result = selectSetupUtxo([small]);
    expect(result).toBeNull();
  });

  it("ignores UTxOs below the threshold even if they are the only ones", () => {
    const justUnder = mkUtxo("a".repeat(64), 0, "19999999");
    const result = selectSetupUtxo([justUnder]);
    expect(result).toBeNull();
  });

  it("picks the first eligible UTxO in array order when multiple qualify", () => {
    const first = mkUtxo("a".repeat(64), 0, "25000000");
    const second = mkUtxo("b".repeat(64), 0, "30000000");
    const result = selectSetupUtxo([first, second]);
    expect(result).toEqual(first);
  });
});

// ─── accumulateFundingUtxos ───────────────────────────────────────────────────

describe("accumulateFundingUtxos", () => {
  it("returns only the auth-token UTxO when it alone meets the requirement", () => {
    const authUtxo = mkUtxo("a".repeat(64), 0, "10000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const extra = mkUtxo("b".repeat(64), 0, "5000000");
    const result = accumulateFundingUtxos([authUtxo, extra], authUtxo, 10_000_000n);
    expect(result).toEqual([authUtxo]);
  });

  it("adds wallet UTxOs in descending lovelace order until threshold is met", () => {
    const authUtxo = mkUtxo("a".repeat(64), 0, "2000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const large = mkUtxo("b".repeat(64), 0, "8000000");
    const small = mkUtxo("c".repeat(64), 0, "1000000");
    // authUtxo (2 ADA) + large (8 ADA) = 10 ADA, which meets 9 ADA threshold
    const result = accumulateFundingUtxos([authUtxo, large, small], authUtxo, 9_000_000n);
    expect(result).toEqual([authUtxo, large]);
  });

  it("skips the auth-token UTxO when scanning wallet candidates", () => {
    const authUtxo = mkUtxo("a".repeat(64), 0, "2000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const other = mkUtxo("b".repeat(64), 0, "5000000");
    const result = accumulateFundingUtxos([authUtxo, other], authUtxo, 6_000_000n);
    // auth (2 ADA) + other (5 ADA) = 7 ADA; auth should appear only once
    expect(result).toHaveLength(2);
    expect(result.filter((u) => u.input.txHash === "a".repeat(64))).toHaveLength(1);
    expect(result).toContain(other);
  });

  it("returns all candidates exhausted without reaching threshold (caller validates)", () => {
    const authUtxo = mkUtxo("a".repeat(64), 0, "2000000", { unit: AUTH_POLICY_ID, quantity: "1" });
    const extra = mkUtxo("b".repeat(64), 0, "3000000");
    // 2 + 3 = 5 ADA, but we require 10 ADA — should return all without throwing
    const result = accumulateFundingUtxos([authUtxo, extra], authUtxo, 10_000_000n);
    expect(result).toEqual([authUtxo, extra]);
  });
});
