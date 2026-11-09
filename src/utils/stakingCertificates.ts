import { getTxBuilder } from "@/utils/get-tx-builder";
import { AUTO_ABSTAIN_DREP, isValidDrepId } from "@/lib/tx-draft/drep";

/** Draft value for the protocol Always-No-Confidence DRep. */
export const NO_CONFIDENCE_DREP = "Always No Confidence";

/** Auto-Abstain, No-Confidence, or a drep1... id. */
export type StakingDRepChoice = string;

export function isValidStakingDRep(choice: string): boolean {
  return choice === NO_CONFIDENCE_DREP || isValidDrepId(choice);
}

function toMeshDRep(choice: StakingDRepChoice) {
  if (choice === AUTO_ABSTAIN_DREP) return { alwaysAbstain: null };
  if (choice === NO_CONFIDENCE_DREP) return { alwaysNoConfidence: null };
  return { dRepId: choice };
}

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
  dRep,
  dRepAlreadyDelegated,
}: {
  txBuilder: Awaited<ReturnType<typeof getTxBuilder>>;
  rewardAddress: string;
  stakingScript: string;
  poolHex: string;
  /** The stake credential already has an on-chain vote delegation, so none is added. */
  dRepAlreadyDelegated?: boolean;
  /** Required for delegate / register_and_delegate: stake never goes to a pool without a DRep. */
  dRep?: StakingDRepChoice;
}): Record<StakingActionApi, StakingActionConfig> {
  const delegateWithDRep = () => {
    if (dRepAlreadyDelegated) {
      txBuilder
        .delegateStakeCertificate(rewardAddress, poolHex)
        .certificateScript(stakingScript);
      return;
    }
    if (!dRep || !isValidStakingDRep(dRep)) {
      throw new Error(
        "Staking requires a DRep: choose Auto-Abstain, No-Confidence, or a drep1... id.",
      );
    }
    txBuilder
      .delegateStakeCertificate(rewardAddress, poolHex)
      .certificateScript(stakingScript);
    txBuilder
      .voteDelegationCertificate(toMeshDRep(dRep), rewardAddress)
      .certificateScript(stakingScript);
  };
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
      execute: delegateWithDRep,
      description: "Delegate stake and vote.",
    },
    register_and_delegate: {
      execute: () => {
        txBuilder
          .registerStakeCertificate(rewardAddress)
          .certificateScript(stakingScript);
        delegateWithDRep();
      },
      description: "Register & delegate stake and vote.",
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
  dRep,
  dRepAlreadyDelegated,
}: {
  txBuilder: Awaited<ReturnType<typeof getTxBuilder>>;
  rewardAddress: string;
  stakingScript: string;
  poolHex: string;
  rewards: string;
  dRep?: StakingDRepChoice;
  dRepAlreadyDelegated?: boolean;
}): Record<StakingActionUi, StakingActionConfig & { successTitle: string; successMessage: string }> {
  const base = buildStakingCertificateActions({
    txBuilder,
    rewardAddress,
    stakingScript,
    poolHex,
    dRep,
    dRepAlreadyDelegated,
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
