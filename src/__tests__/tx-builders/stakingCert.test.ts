import { describe, it, expect } from "@jest/globals";
import {
  buildStakingCertificateActions,
  buildStakingActionConfigs,
} from "@/utils/stakingCertificates";
import {
  REWARD_ADDRESS,
  STAKING_SCRIPT_CBOR,
  POOL_HEX,
} from "./fixtures";

type CertCall =
  | { type: "register"; address: string }
  | { type: "deregister"; address: string }
  | { type: "delegate"; address: string; poolHex: string }
  | { type: "withdrawal"; address: string; amount: string };

function createCertBuilderMock() {
  const calls: CertCall[] = [];

  const builder = {
    registerStakeCertificate: (address: string) => {
      calls.push({ type: "register", address });
      return builder;
    },
    deregisterStakeCertificate: (address: string) => {
      calls.push({ type: "deregister", address });
      return builder;
    },
    delegateStakeCertificate: (address: string, poolHex: string) => {
      calls.push({ type: "delegate", address, poolHex });
      return builder;
    },
    certificateScript: (_scriptCbor: string) => builder,
    withdrawal: (address: string, amount: string) => {
      calls.push({ type: "withdrawal", address, amount });
      return builder;
    },
  };

  return { builder, calls };
}

describe("buildStakingCertificateActions", () => {
  it("register action calls registerStakeCertificate with reward address", () => {
    const { builder, calls } = createCertBuilderMock();
    const actions = buildStakingCertificateActions({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
    });

    actions.register.execute();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "register", address: REWARD_ADDRESS });
  });

  it("deregister action calls deregisterStakeCertificate with reward address", () => {
    const { builder, calls } = createCertBuilderMock();
    const actions = buildStakingCertificateActions({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
    });

    actions.deregister.execute();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "deregister", address: REWARD_ADDRESS });
  });

  it("delegate action calls delegateStakeCertificate with reward address and pool", () => {
    const { builder, calls } = createCertBuilderMock();
    const actions = buildStakingCertificateActions({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
    });

    actions.delegate.execute();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "delegate", address: REWARD_ADDRESS, poolHex: POOL_HEX });
  });

  it("register_and_delegate action calls both register and delegate in order", () => {
    const { builder, calls } = createCertBuilderMock();
    const actions = buildStakingCertificateActions({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
    });

    actions.register_and_delegate.execute();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ type: "register", address: REWARD_ADDRESS });
    expect(calls[1]).toMatchObject({ type: "delegate", address: REWARD_ADDRESS, poolHex: POOL_HEX });
  });

  it("delegate with empty poolHex does not throw (pool validation is on-chain)", () => {
    const { builder } = createCertBuilderMock();
    const actions = buildStakingCertificateActions({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: "",
    });

    expect(() => actions.delegate.execute()).not.toThrow();
  });

  it("all actions have a description string", () => {
    const { builder } = createCertBuilderMock();
    const actions = buildStakingCertificateActions({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
    });

    for (const [, config] of Object.entries(actions)) {
      expect(typeof config.description).toBe("string");
      expect(config.description.length).toBeGreaterThan(0);
    }
  });
});

describe("buildStakingActionConfigs", () => {
  it("withdrawal action calls withdrawal with reward address and rewards amount", () => {
    const { builder, calls } = createCertBuilderMock();
    const rewards = "5000000";
    const configs = buildStakingActionConfigs({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
      rewards,
    });

    configs.withdrawal.execute();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "withdrawal", address: REWARD_ADDRESS, amount: rewards });
  });

  it("registerAndDelegate action calls both register and delegate in order", () => {
    const { builder, calls } = createCertBuilderMock();
    const configs = buildStakingActionConfigs({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
      rewards: "0",
    });

    configs.registerAndDelegate.execute();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ type: "register", address: REWARD_ADDRESS });
    expect(calls[1]).toMatchObject({ type: "delegate", address: REWARD_ADDRESS, poolHex: POOL_HEX });
  });

  it("all configs include successTitle and successMessage", () => {
    const { builder } = createCertBuilderMock();
    const configs = buildStakingActionConfigs({
      txBuilder: builder as never,
      rewardAddress: REWARD_ADDRESS,
      stakingScript: STAKING_SCRIPT_CBOR,
      poolHex: POOL_HEX,
      rewards: "0",
    });

    for (const [, config] of Object.entries(configs)) {
      expect(typeof config.successTitle).toBe("string");
      expect(config.successTitle.length).toBeGreaterThan(0);
      expect(typeof config.successMessage).toBe("string");
      expect(config.successMessage.length).toBeGreaterThan(0);
    }
  });
});
