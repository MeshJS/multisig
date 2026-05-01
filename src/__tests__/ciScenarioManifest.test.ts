import { describe, expect, it } from "@jest/globals";
import { getScenarioManifest, ROUTE_SCENARIO_IDS } from "../../scripts/ci/scenarios/manifest";
import type { CIBootstrapContext, CIWalletType } from "../../scripts/ci/framework/types";

const mkContext = (walletTypes: CIWalletType[]): CIBootstrapContext => ({
  schemaVersion: 3,
  createdAt: "2026-04-29T00:00:00.000Z",
  apiBaseUrl: "http://localhost:3000",
  networkId: 0,
  walletTypes,
  wallets: walletTypes.map((type) => ({
    type,
    walletId: `${type}-wallet-id`,
    walletAddress: `addr_test_${type}`,
    signerAddresses: ["addr_test_signer_1", "addr_test_signer_2", "addr_test_signer_3"],
  })),
  bots: [
    {
      id: "bot-1",
      paymentAddress: "addr_test_signer_1",
      botKeyId: "bot-key-1",
      botId: "bot-user-1",
    },
  ],
  defaultBotId: "bot-1",
  signerAddresses: ["addr_test_signer_1", "addr_test_signer_2", "addr_test_signer_3"],
  signerStakeAddresses: ["stake_test_1", "stake_test_2", "stake_test_3"],
});

describe("route-chain scenario manifest", () => {
  it("exposes all known scenario ids for filter validation", () => {
    expect(ROUTE_SCENARIO_IDS).toContain("scenario.proxy-smoke");
    expect(ROUTE_SCENARIO_IDS).toContain("scenario.real-transfer-and-sign");
  });

  it("runs create-wallet before request-heavy default-bot scenarios", () => {
    const scenarios = getScenarioManifest(mkContext(["legacy", "hierarchical", "sdk"]));
    const ids = scenarios.map((scenario) => scenario.id);

    expect(ids.indexOf("scenario.create-wallet")).toBeLessThan(
      ids.indexOf("scenario.bot-identity"),
    );
    expect(ids.indexOf("scenario.create-wallet")).toBeLessThan(
      ids.indexOf("scenario.auth-plane"),
    );
    expect(ids.indexOf("scenario.create-wallet")).toBeLessThan(
      ids.indexOf("scenario.proxy-smoke"),
    );
  });

  it("builds a proxy-smoke subset without requiring ring-transfer wallets", () => {
    const scenarios = getScenarioManifest(mkContext(["legacy"]), ["scenario.proxy-smoke"]);

    expect(scenarios.map((scenario) => scenario.id)).toEqual(["scenario.proxy-smoke"]);
  });

  it("builds a create-wallet subset without running prior auth/proxy scenarios", () => {
    const scenarios = getScenarioManifest(mkContext(["legacy"]), ["scenario.create-wallet"]);

    expect(scenarios.map((scenario) => scenario.id)).toEqual(["scenario.create-wallet"]);
  });

  it("still fails clearly when ring transfer is requested without all wallet types", () => {
    expect(() =>
      getScenarioManifest(mkContext(["legacy"]), ["scenario.real-transfer-and-sign"]),
    ).toThrow(/Ring transfer scenario requires wallet types/);
  });
});
