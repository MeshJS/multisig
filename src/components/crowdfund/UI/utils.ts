import { GovernanceConfig } from "../offchain";

export type RawGovExtension = {
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

export const parseGovDatum = (
  govDatum?: string | null,
): RawGovExtension | null => {
  if (!govDatum) {
    return null;
  }
  try {
    const parsed = JSON.parse(govDatum);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.error("Failed to parse govDatum", error);
    return null;
  }
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

/**
 * Determine governance state from datum
 * Returns: 0=Crowdfund, 1=RegisteredCerts, 2=Proposed, 3=Voted, 4=Refundable
 */
export const getGovStateFromDatum = (datum: any): number => {
  if (!datum) return 0;

  // Check if datum has gov_tx_id (Voted state = 3)
  if ("gov_tx_id" in datum && datum.gov_tx_id) {
    return 3;
  }

  // Check if datum has funds_controlled but no current_fundraised_amount
  if ("funds_controlled" in datum && !("current_fundraised_amount" in datum)) {
    // If it has deadline but no gov_tx_id, check if it's Proposed (2) or RegisteredCerts (1)
    if ("deadline" in datum && !("gov_tx_id" in datum)) {
      // If we can't distinguish, default to Proposed (2) as it's more advanced
      // In practice, you'd check the on-chain state to be sure
      return 2; // Proposed
    }
    // If it has funds_controlled but no deadline, it's Refundable (4)
    if (!("deadline" in datum)) {
      return 4; // Refundable
    }
    // Otherwise RegisteredCerts (1)
    return 1; // RegisteredCerts
  }

  // If it has current_fundraised_amount, it's Crowdfund (0)
  if ("current_fundraised_amount" in datum) {
    return 0; // Crowdfund
  }

  // Default to Crowdfund
  return 0;
};

