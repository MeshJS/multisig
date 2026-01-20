import { describe, expect, it } from "@jest/globals";
import { mapGovExtensionToConfig } from "@/components/crowdfund/UI/utils";

describe("mapGovExtensionToConfig", () => {
  it("maps governance extension payload to config with numeric coercion", () => {
    const config = mapGovExtensionToConfig({
      delegate_pool_id: "pool1xyz",
      gov_action_period: 8,
      stake_register_deposit: "2500000",
      drep_register_deposit: 600000000,
      gov_deposit: "750000000",
      govActionMetadataUrl: "https://example.com/ga.json",
      govActionMetadataHash: "abcd1234",
      drepMetadataUrl: "https://example.com/drep.json",
      drepMetadataHash: "ffff1111",
    });

    expect(config).toEqual({
      delegatePoolId: "pool1xyz",
      govActionPeriod: 8,
      stakeRegisterDeposit: 2_500_000,
      drepRegisterDeposit: 600_000_000,
      govDeposit: 750_000_000,
      anchorGovAction: {
        url: "https://example.com/ga.json",
        hash: "abcd1234",
      },
      anchorDrep: {
        url: "https://example.com/drep.json",
        hash: "ffff1111",
      },
    });
  });

  it("throws when delegate_pool_id is missing", () => {
    expect(() =>
      mapGovExtensionToConfig({
        stake_register_deposit: 2_000_000,
      }),
    ).toThrow("delegate_pool_id is missing");
  });

  it("throws when extension payload is undefined", () => {
    expect(() => mapGovExtensionToConfig()).toThrow(
      "Governance extension data is required",
    );
  });
});

