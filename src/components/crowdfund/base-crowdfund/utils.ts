import { GovernanceConfig } from "../offchain";

type RawGovExtension = {
  delegate_pool_id?: string;
  gov_action_period?: number;
  stake_register_deposit?: number | string;
  drep_register_deposit?: number | string;
  gov_deposit?: number | string;
  govActionMetadataUrl?: string;
  govActionMetadataHash?: string;
  drepMetadataUrl?: string;
  drepMetadataHash?: string;
};

export const mapGovExtensionToConfig = (
  extension?: RawGovExtension | null,
): GovernanceConfig => {
  if (!extension) {
    throw new Error("Governance extension data is required for this action.");
  }

  if (!extension.delegate_pool_id) {
    throw new Error("delegate_pool_id is missing from governance extension.");
  }

  const toNumber = (value: number | string | undefined, fallback: number) =>
    value != null ? Number(value) : fallback;

  return {
    delegatePoolId: extension.delegate_pool_id,
    govActionPeriod: toNumber(extension.gov_action_period, 6),
    stakeRegisterDeposit: toNumber(extension.stake_register_deposit, 2_000_000),
    drepRegisterDeposit: toNumber(extension.drep_register_deposit, 500_000_000),
    govDeposit: toNumber(extension.gov_deposit, 0),
    anchorGovAction:
      extension.govActionMetadataUrl && extension.govActionMetadataHash
        ? {
            url: extension.govActionMetadataUrl,
            hash: extension.govActionMetadataHash,
          }
        : undefined,
    anchorDrep:
      extension.drepMetadataUrl && extension.drepMetadataHash
        ? {
            url: extension.drepMetadataUrl,
            hash: extension.drepMetadataHash,
          }
        : undefined,
  };
};

