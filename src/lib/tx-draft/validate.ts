import { deserializeAddress } from "@meshsdk/core";

import type { TxDraft } from "@/types/tx-draft";
import { normalizePoolIdForDelegation } from "@/utils/normalizePoolId";
import {
  materializeOutputAssets,
  requiredAssetTotals,
  safeBigInt,
} from "./assets";
import { hasMultisigOnlyActions } from "./mutations";

export type DraftIssueCode =
  | "no-outputs"
  | "missing-address"
  | "invalid-address"
  | "wrong-network-address"
  | "no-amount"
  | "min-ada-topup"
  | "insufficient-funds"
  | "duplicate-output"
  | "vote-drep-missing"
  | "cert-stake-missing"
  | "cert-pool-missing"
  | "duplicate-vote"
  | "cert-duplicate"
  | "source-address-missing"
  | "source-address-invalid"
  | "source-address-wrong-network"
  | "source-address-script"
  | "source-address-is-connected"
  | "source-actions-unsupported";

/** Issue codes about the funding source (rendered next to the source picker). */
export function isSourceIssue(code: DraftIssueCode): boolean {
  return code.startsWith("source-");
}

export type DraftIssue = {
  level: "error" | "warning";
  code: DraftIssueCode;
  message: string;
  /** Anchors the issue to an output so the UI can select the offending card. */
  outputId?: string;
};

export type ValidateDraftContext = {
  /** 1 = mainnet, otherwise testnet — matches the site store's network. */
  network: number;
  /**
   * Funds the transaction can draw from (manual selection or full available
   * balance in auto mode), keyed by unit. Omit while still loading to skip
   * the sufficiency check.
   */
  selectedFunds?: Map<string, bigint>;
  /**
   * Whether a DRep identity could be derived for the wallet. Omit while
   * still loading (or when the draft has no votes) to skip the check.
   */
  hasDrepContext?: boolean;
  /**
   * Whether a staking identity (reward address + staking script) could be
   * derived for the wallet. Omit while still loading (or when the draft has
   * no certificates) to skip the check.
   */
  hasStakeContext?: boolean;
  /** The multisig's own address; lets the source check name it. */
  multisigAddress?: string;
  /** The connected wallet's address; absent when no wallet is connected. */
  connectedAddress?: string;
};

export type ValidateSourceContext = Pick<
  ValidateDraftContext,
  "network" | "multisigAddress" | "connectedAddress"
>;

export function isValidPaymentAddress(address: string): boolean {
  if (!address.startsWith("addr")) return false; // excludes stake/DRep ids
  try {
    deserializeAddress(address);
    return true;
  } catch {
    return false;
  }
}

/** Payment credential is a script (multisig / contract), not a key. */
function isScriptAddress(address: string): boolean {
  try {
    return deserializeAddress(address).scriptHash !== "";
  } catch {
    return false;
  }
}

function isMainnetAddress(address: string): boolean {
  return !address.startsWith("addr_test");
}

function wrongNetworkMessage(address: string, network: number): string {
  return `Address belongs to ${isMainnetAddress(address) ? "mainnet" : "a testnet"}, but the wallet is on ${network === 1 ? "mainnet" : "a testnet"}.`;
}

/**
 * Validates the funding source alone. Split out from `validateDraft` so the
 * page can decide whether to fetch the source's UTxOs before the full
 * validation (which needs those UTxOs for the sufficiency check) runs.
 */
export function validateSource(
  draft: TxDraft,
  ctx: ValidateSourceContext,
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const { source } = draft;

  if (source.kind === "connected" && !ctx.connectedAddress) {
    issues.push({
      level: "error",
      code: "source-address-missing",
      message: "Connect a wallet to build a transaction from it.",
    });
  }

  if (source.kind === "address") {
    const address = source.address.trim();
    if (!address) {
      issues.push({
        level: "error",
        code: "source-address-missing",
        message: "Enter the address of the wallet to build from.",
      });
    } else if (!isValidPaymentAddress(address)) {
      issues.push({
        level: "error",
        code: "source-address-invalid",
        message: "Source is not a valid Cardano payment address.",
      });
    } else if (isScriptAddress(address)) {
      issues.push({
        level: "error",
        code: "source-address-script",
        message:
          address === ctx.multisigAddress
            ? "This is the multisig's own address — choose the Multisig source instead."
            : "This is a script address — only regular key-based wallet addresses can be a source.",
      });
    } else if (isMainnetAddress(address) !== (ctx.network === 1)) {
      issues.push({
        level: "error",
        code: "source-address-wrong-network",
        message: `Source: ${wrongNetworkMessage(address, ctx.network)}`,
      });
    } else if (address === ctx.connectedAddress) {
      issues.push({
        level: "warning",
        code: "source-address-is-connected",
        message:
          "This is your connected wallet — choose the Connected wallet source to sign and submit here.",
      });
    }
  }

  // Backstop: setSource clears these when leaving the multisig.
  if (source.kind !== "multisig" && hasMultisigOnlyActions(draft)) {
    issues.push({
      level: "error",
      code: "source-actions-unsupported",
      message:
        "Staking actions and votes can only be built from the multisig wallet.",
    });
  }

  return issues;
}

/**
 * Pure validation over a draft. Errors block building; warnings only inform.
 * The Build button is gated on the absence of errors.
 */
export function validateDraft(
  draft: TxDraft,
  ctx: ValidateDraftContext,
): DraftIssue[] {
  const issues: DraftIssue[] = [...validateSource(draft, ctx)];

  if (
    draft.outputs.length === 0 &&
    draft.votes.length === 0 &&
    draft.certificates.length === 0
  ) {
    issues.push({
      level: "error",
      code: "no-outputs",
      message: "Add at least one recipient, vote, or certificate.",
    });
  }

  if (draft.votes.length > 0 && ctx.hasDrepContext === false) {
    issues.push({
      level: "error",
      code: "vote-drep-missing",
      message:
        "This wallet has no DRep identity — governance votes can't be rebuilt.",
    });
  }

  if (draft.certificates.length > 0 && ctx.hasStakeContext === false) {
    issues.push({
      level: "error",
      code: "cert-stake-missing",
      message:
        "This wallet has no staking identity — staking certificates can't be rebuilt.",
    });
  }

  // Defensive: the inspector normalizes pool ids on entry, but a loaded tx
  // may carry a pool id that didn't normalize (kept raw by txJsonToDraft).
  for (const cert of draft.certificates) {
    if (cert.kind !== "DelegateStake") continue;
    let valid = false;
    try {
      valid = !!cert.poolId && !!normalizePoolIdForDelegation(cert.poolId);
    } catch {
      valid = false;
    }
    if (!valid) {
      issues.push({
        level: "error",
        code: "cert-pool-missing",
        message: "Delegation certificate has no valid stake pool id.",
      });
      break; // one summary issue is enough
    }
  }

  // Two votes on the same governance action collide in the on-chain
  // voting_procedures map — only one would survive.
  const seenActions = new Set<string>();
  for (const vote of draft.votes) {
    const actionId = `${vote.govActionTxHash}#${vote.govActionIndex}`;
    if (seenActions.has(actionId)) {
      issues.push({
        level: "error",
        code: "duplicate-vote",
        message: "Two votes target the same governance action.",
      });
      break; // one summary issue is enough
    }
    seenActions.add(actionId);
  }

  // A single reward address can't meaningfully carry two certs of the same
  // kind; the add-stake dialog prevents this, so this is a backstop.
  const seenKinds = new Set<string>();
  for (const cert of draft.certificates) {
    if (seenKinds.has(cert.kind)) {
      issues.push({
        level: "error",
        code: "cert-duplicate",
        message: "The draft has two staking certificates of the same kind.",
      });
      break; // one summary issue is enough
    }
    seenKinds.add(cert.kind);
  }

  const seenAddresses = new Set<string>();
  for (const output of draft.outputs) {
    if (!output.address) {
      issues.push({
        level: "error",
        code: "missing-address",
        message: "Recipient has no address yet.",
        outputId: output.id,
      });
    } else if (!isValidPaymentAddress(output.address)) {
      issues.push({
        level: "error",
        code: "invalid-address",
        message: "Not a valid Cardano payment address.",
        outputId: output.id,
      });
    } else {
      if (isMainnetAddress(output.address) !== (ctx.network === 1)) {
        issues.push({
          level: "error",
          code: "wrong-network-address",
          message: wrongNetworkMessage(output.address, ctx.network),
          outputId: output.id,
        });
      }
      if (seenAddresses.has(output.address)) {
        issues.push({
          level: "warning",
          code: "duplicate-output",
          message: "Another output already pays this address.",
          outputId: output.id,
        });
      }
      seenAddresses.add(output.address);
    }

    const hasAmount = output.assets.some((asset) => {
      const quantity = safeBigInt(asset.quantity);
      return quantity !== undefined && quantity > 0n;
    });
    if (!hasAmount) {
      issues.push({
        level: "error",
        code: "no-amount",
        message: "Recipient has no amount yet.",
        outputId: output.id,
      });
    } else if (
      materializeOutputAssets(output.assets).length > output.assets.length
    ) {
      issues.push({
        level: "warning",
        code: "min-ada-topup",
        message:
          "Token-only output — min ADA will be added automatically at build time.",
        outputId: output.id,
      });
    }
  }

  if (ctx.selectedFunds) {
    const totals = requiredAssetTotals(draft);
    // The 2 ADA stake key deposit is paid from inputs but appears in no
    // output, so fold it into the required lovelace.
    const registerCount = draft.certificates.filter(
      (cert) => cert.kind === "RegisterStake",
    ).length;
    if (registerCount > 0) {
      totals.set(
        "lovelace",
        (totals.get("lovelace") ?? 0n) + 2_000_000n * BigInt(registerCount),
      );
    }
    for (const [unit, required] of totals) {
      const available = ctx.selectedFunds.get(unit) ?? 0n;
      if (required > available) {
        issues.push({
          level: "error",
          code: "insufficient-funds",
          message:
            unit === "lovelace"
              ? "Outputs require more ADA than the selected funds hold."
              : "Outputs require more of a token than the selected funds hold.",
        });
        break; // one summary issue is enough
      }
    }
  }

  return issues;
}
