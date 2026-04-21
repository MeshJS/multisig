import { getTxBuilder } from "@/utils/get-tx-builder";

export type StakingActionApi =
  | "register"
  | "deregister"
  | "delegate"
  | "register_and_delegate";

export type StakingActionUi =
  | "register"
  | "deregister"
  | "delegate"
  | "withdrawal"
  | "registerAndDelegate";

type StakingActionConfig = {
  execute: () => void;
  description: string;
};

/**
 * Mirrors StakingActions/stake.tsx certificate wiring (minus withdrawal, which needs reward balance).
 */
export function buildStakingCertificateActions({
  txBuilder,
  rewardAddress,
  stakingScript,
  poolHex,
}: {
  txBuilder: ReturnType<typeof getTxBuilder>;
  rewardAddress: string;
  stakingScript: string;
  poolHex: string;
}): Record<StakingActionApi, StakingActionConfig> {
  return {
    register: {
      execute: () =>
        txBuilder
          .registerStakeCertificate(rewardAddress)
          .certificateScript(stakingScript),
      description: "Register stake.",
    },
    deregister: {
      execute: () =>
        txBuilder
          .deregisterStakeCertificate(rewardAddress)
          .certificateScript(stakingScript),
      description: "Deregister stake.",
    },
    delegate: {
      execute: () =>
        txBuilder
          .delegateStakeCertificate(rewardAddress, poolHex)
          .certificateScript(stakingScript),
      description: "Delegate stake.",
    },
    register_and_delegate: {
      execute: () => {
        txBuilder
          .registerStakeCertificate(rewardAddress)
          .certificateScript(stakingScript);
        txBuilder
          .delegateStakeCertificate(rewardAddress, poolHex)
          .certificateScript(stakingScript);
      },
      description: "Register & delegate stake.",
    },
  };
}

/** UI + withdrawal — same as stake.tsx StakingActionConfig map. */
export function buildStakingActionConfigs({
  txBuilder,
  rewardAddress,
  stakingScript,
  poolHex,
  rewards,
}: {
  txBuilder: ReturnType<typeof getTxBuilder>;
  rewardAddress: string;
  stakingScript: string;
  poolHex: string;
  rewards: string;
}): Record<StakingActionUi, StakingActionConfig & { successTitle: string; successMessage: string }> {
  const base = buildStakingCertificateActions({
    txBuilder,
    rewardAddress,
    stakingScript,
    poolHex,
  });
  return {
    register: {
      ...base.register,
      successTitle: "Stake Registered",
      successMessage: "Your stake address has been registered.",
    },
    deregister: {
      ...base.deregister,
      successTitle: "Stake Deregistered",
      successMessage: "Your stake address has been deregistered.",
    },
    delegate: {
      ...base.delegate,
      successTitle: "Stake Delegated",
      successMessage: "Your stake has been delegated.",
    },
    withdrawal: {
      execute: () => txBuilder.withdrawal(rewardAddress, rewards),
      description: "Withdraw rewards.",
      successTitle: "Rewards Withdrawn",
      successMessage: "Your staking rewards have been withdrawn.",
    },
    registerAndDelegate: {
      ...base.register_and_delegate,
      successTitle: "Stake Registered & Delegated",
      successMessage: "Your stake address has been registered and delegated.",
    },
  };
}
