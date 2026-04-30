import { describe, expect, it } from "@jest/globals";
import {
  DREP_REGISTER_REQUIRED_LOVELACE,
  normalizeJsonArtifact,
  PROXY_ACTION_FEE_BUFFER_LOVELACE,
  PROXY_ACTION_REQUIRED_LOVELACE,
  selectAuthTokenRefs,
  selectAuthTokenRefsWithMinLovelace,
  selectDRepRegisterRefs,
  selectSetupRefs,
  splitProxyActionSelection,
  type ScriptUtxo,
} from "../../scripts/ci/scenarios/steps/proxyBot";

const AUTH_TOKEN_ID = "policy.asset";

const mkUtxo = (
  lovelace: string,
  txHash: string,
  outputIndex = 0,
  tokenQuantity?: string,
  address = "addr_test_wallet",
): ScriptUtxo => ({
  input: { txHash, outputIndex },
  output: {
    address,
    amount: [
      { unit: "lovelace", quantity: lovelace },
      ...(tokenQuantity ? [{ unit: AUTH_TOKEN_ID, quantity: tokenQuantity }] : []),
    ],
  },
});

describe("proxy bot UTxO selection", () => {
  it("selects setup from wallet UTxOs and collateral from key-address UTxOs", () => {
    const refs = selectSetupRefs({
      walletUtxos: [mkUtxo("20000000", "setup")],
      collateralUtxos: [mkUtxo("6000000", "collateral", 0, undefined, "addr_test_signer_1")],
    });

    expect(refs.utxoRefs).toEqual([{ txHash: "setup", outputIndex: 0 }]);
    expect(refs.collateralRef).toEqual({ txHash: "collateral", outputIndex: 0 });
  });

  it("rejects setup when only wallet script UTxOs could act as collateral", () => {
    expect(() =>
      selectSetupRefs({
        walletUtxos: [mkUtxo("20000000", "setup"), mkUtxo("6000000", "script-collateral")],
        collateralUtxos: [],
      }),
    ).toThrow(
      /bot payment-address collateral UTxO/,
    );
  });

  it("rejects auth-token selection without key-address collateral", () => {
    expect(() =>
      selectAuthTokenRefs({
        walletUtxos: [mkUtxo("6000000", "token", 0, "1")],
        collateralUtxos: [],
        authTokenId: AUTH_TOKEN_ID,
      }),
    ).toThrow(/bot payment-address collateral UTxO/);
  });

  it("adds funding inputs for DRep register while keeping collateral separate", () => {
    const refs = selectDRepRegisterRefs({
      walletUtxos: [
        mkUtxo("2000000", "token", 0, "1"),
        mkUtxo("300000000", "funding-a"),
        mkUtxo("230000000", "funding-b"),
      ],
      collateralUtxos: [mkUtxo("6000000", "collateral", 0, undefined, "addr_test_signer_1")],
      authTokenId: AUTH_TOKEN_ID,
      requiredLovelace: DREP_REGISTER_REQUIRED_LOVELACE + 20_000_000n,
    });

    expect(refs.utxoRefs).toEqual([
      { txHash: "token", outputIndex: 0 },
      { txHash: "funding-a", outputIndex: 0 },
      { txHash: "funding-b", outputIndex: 0 },
    ]);
    expect(refs.collateralRef).toEqual({ txHash: "collateral", outputIndex: 0 });
    expect(refs.selectedLovelace).toBe(532_000_000n);
  });

  it("splits DRep register diagnostics away from JSON request refs", () => {
    const selection = selectDRepRegisterRefs({
      walletUtxos: [
        mkUtxo("2000000", "token", 0, "1"),
        mkUtxo("300000000", "funding-a"),
        mkUtxo("230000000", "funding-b"),
      ],
      collateralUtxos: [mkUtxo("6000000", "collateral", 0, undefined, "addr_test_signer_1")],
      authTokenId: AUTH_TOKEN_ID,
      requiredLovelace: DREP_REGISTER_REQUIRED_LOVELACE + 20_000_000n,
    });

    const { requestRefs, selectionArtifacts } = splitProxyActionSelection(selection);

    expect(requestRefs).toEqual({
      utxoRefs: [
        { txHash: "token", outputIndex: 0 },
        { txHash: "funding-a", outputIndex: 0 },
        { txHash: "funding-b", outputIndex: 0 },
      ],
      collateralRef: { txHash: "collateral", outputIndex: 0 },
    });
    expect(selectionArtifacts).toEqual({
      selectedLovelace: "532000000",
      requiredLovelace: "525000000",
    });
    expect(requestRefs).not.toHaveProperty("selectedLovelace");
    expect(JSON.stringify(requestRefs)).not.toContain("532000000");
  });

  it("adds funding inputs for auth-token actions while keeping collateral separate", () => {
    const selection = selectAuthTokenRefsWithMinLovelace({
      walletUtxos: [
        mkUtxo("1200000", "token", 0, "1"),
        mkUtxo("2500000", "funding-a"),
        mkUtxo("900000", "funding-b"),
      ],
      collateralUtxos: [mkUtxo("6000000", "collateral", 0, undefined, "addr_test_signer_1")],
      authTokenId: AUTH_TOKEN_ID,
      requiredLovelace: PROXY_ACTION_REQUIRED_LOVELACE + PROXY_ACTION_FEE_BUFFER_LOVELACE,
      context: "proxy vote",
    });

    expect(selection.utxoRefs).toEqual([
      { txHash: "token", outputIndex: 0 },
      { txHash: "funding-a", outputIndex: 0 },
      { txHash: "funding-b", outputIndex: 0 },
    ]);
    expect(selection.collateralRef).toEqual({ txHash: "collateral", outputIndex: 0 });
    expect(selection.selectedLovelace).toBe(4_600_000n);
    expect(selection.requiredLovelace).toBe(4_000_000n);
  });

  it("splits auth-token action diagnostics away from request refs", () => {
    const selection = selectAuthTokenRefsWithMinLovelace({
      walletUtxos: [
        mkUtxo("1200000", "token", 0, "1"),
        mkUtxo("3000000", "funding-a"),
      ],
      collateralUtxos: [mkUtxo("6000000", "collateral", 0, undefined, "addr_test_signer_1")],
      authTokenId: AUTH_TOKEN_ID,
      requiredLovelace: PROXY_ACTION_REQUIRED_LOVELACE + PROXY_ACTION_FEE_BUFFER_LOVELACE,
      context: "proxy vote",
    });

    const { requestRefs, selectionArtifacts } = splitProxyActionSelection(selection);

    expect(requestRefs).toEqual({
      utxoRefs: [
        { txHash: "token", outputIndex: 0 },
        { txHash: "funding-a", outputIndex: 0 },
      ],
      collateralRef: { txHash: "collateral", outputIndex: 0 },
    });
    expect(selectionArtifacts).toEqual({
      selectedLovelace: "4200000",
      requiredLovelace: "4000000",
    });
    expect(requestRefs).not.toHaveProperty("selectedLovelace");
  });

  it("normalizes nested BigInt artifacts without changing request contracts", () => {
    expect(
      normalizeJsonArtifact({
        selectedLovelace: 1n,
        nested: [{ requiredLovelace: 2n }],
      }),
    ).toEqual({
      selectedLovelace: "1",
      nested: [{ requiredLovelace: "2" }],
    });
  });

  it("rejects DRep register when only token and collateral are available", () => {
    expect(() =>
      selectDRepRegisterRefs({
        walletUtxos: [
          mkUtxo("2000000", "token", 0, "1"),
        ],
        collateralUtxos: [mkUtxo("6000000", "collateral", 0, undefined, "addr_test_signer_1")],
        authTokenId: AUTH_TOKEN_ID,
        requiredLovelace: DREP_REGISTER_REQUIRED_LOVELACE,
      }),
    ).toThrow(/requires 505 ADA in selected wallet inputs/);
  });

  it("rejects auth-token min-lovelace actions when selected wallet inputs are too small", () => {
    expect(() =>
      selectAuthTokenRefsWithMinLovelace({
        walletUtxos: [mkUtxo("1200000", "token", 0, "1")],
        collateralUtxos: [mkUtxo("6000000", "collateral", 0, undefined, "addr_test_signer_1")],
        authTokenId: AUTH_TOKEN_ID,
        requiredLovelace: PROXY_ACTION_REQUIRED_LOVELACE + PROXY_ACTION_FEE_BUFFER_LOVELACE,
        context: "proxy vote",
      }),
    ).toThrow(/proxy vote requires 4 ADA in selected wallet inputs/);
  });
});
