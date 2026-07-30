import { deserializeAddress } from "@meshsdk/core";

import type { TxDraft } from "@/types/tx-draft";
import {
  materializeOutputAssets,
  requiredAssetTotals,
  safeBigInt,
} from "./assets";

export type DraftIssueCode =
  | "no-outputs"
  | "missing-address"
  | "invalid-address"
  | "wrong-network-address"
  | "no-amount"
  | "min-ada-topup"
  | "insufficient-funds"
  | "duplicate-output";

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
};

function isValidPaymentAddress(address: string): boolean {
  if (!address.startsWith("addr")) return false; // excludes stake/DRep ids
  try {
    deserializeAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure validation over a draft. Errors block building; warnings only inform.
 * The Build button is gated on the absence of errors.
 */
export function validateDraft(
  draft: TxDraft,
  ctx: ValidateDraftContext,
): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (draft.outputs.length === 0) {
    issues.push({
      level: "error",
      code: "no-outputs",
      message: "Add at least one recipient.",
    });
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
      const isMainnetAddress = !output.address.startsWith("addr_test");
      if (isMainnetAddress !== (ctx.network === 1)) {
        issues.push({
          level: "error",
          code: "wrong-network-address",
          message: `Address belongs to ${isMainnetAddress ? "mainnet" : "a testnet"}, but the wallet is on ${ctx.network === 1 ? "mainnet" : "a testnet"}.`,
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
    for (const [unit, required] of requiredAssetTotals(draft)) {
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
