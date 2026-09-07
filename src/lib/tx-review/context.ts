import type { PrismaClient, Wallet as DbWallet } from "@prisma/client";
import type { UTxO } from "@meshsdk/core";

import type { McpCaller } from "@/lib/mcp/auth";
import type { ApplyDraftContext } from "@/lib/tx-draft/to-tx-builder";
import { deriveDrepVoteContext, type DrepVoteContext } from "@/lib/governance/drep-context";
import { deriveStakeCertContext, type StakeCertContext } from "@/lib/staking/stake-context";
import { getRequiredSignerCount } from "@/lib/notifications/center";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import type { DbWalletWithLegacy, Wallet } from "@/types/wallet";
import { buildMultisigWallet, buildWallet } from "@/utils/common";
import type { MultisigWallet } from "@/utils/multisigSDK";
import { resolveExpectedPaymentScriptCbor } from "@/utils/txScriptRecovery";

/**
 * Everything the review pipeline needs to know about a wallet, resolved once
 * per tool call on the server — the same derivations the canvas builder does
 * client-side in `draftBuildContext` (`src/components/pages/wallet/build`),
 * and the bot certificate handlers do in `src/pages/api/v1/bot*Certificate.ts`.
 */

export type TxReviewErrorCode =
  | "NOT_SIGNER"
  | "NOT_FOUND"
  | "NO_SCRIPT"
  | "BOT_NOT_ALLOWED"
  | "INVALID_ADDRESS"
  | "INVALID_SPEC"
  | "INVALID_DRAFT"
  | "UTXO_LOOKUP_FAILED"
  | "BUILD_FAILED"
  | "PIN_FAILED"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED";

/**
 * A failure the model can read and act on. `status` maps to the tool
 * result's `isError`; `details` (issue lists and the like) travels in the
 * body so the model can tell the human exactly what to fix.
 */
export class TxReviewError extends Error {
  constructor(
    readonly status: number,
    readonly code: TxReviewErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TxReviewError";
  }

  toResult(): { status: number; body: Record<string, unknown> } {
    return {
      status: this.status,
      body: { error: this.message, code: this.code, ...(this.details ?? {}) },
    };
  }
}

export type ReviewWalletContext = {
  walletRow: DbWallet;
  appWallet: Wallet;
  multisigWallet: MultisigWallet | undefined;
  network: 0 | 1;
  /** The wallet's script address: owner of the inputs and change target. */
  walletAddress: string;
  /** Payment script CBOR whose hash matches the address. */
  scriptCbor: string;
  drep: DrepVoteContext | undefined;
  stake: StakeCertContext | undefined;
  threshold: { required: number; total: number; type: string };
};

export function networkFromAddress(address: string): 0 | 1 {
  // bech32 HRP, not a substring test: `addr1`/`stake1` = mainnet,
  // `addr_test1`/`stake_test1` = testnet (see addTransaction.ts).
  if (/^(addr_test1|stake_test1)/.test(address)) return 0;
  if (/^(addr1|stake1)/.test(address)) return 1;
  throw new TxReviewError(400, "INVALID_ADDRESS", "Caller address is not a Cardano address");
}

/**
 * Load the wallet and authorize the caller as one of its signers.
 *
 * Only humans: the scope is not projected onto bot keys, and this is the
 * belt to that brace. A bot with `multisig:sign` already has the REST route
 * (`addTransaction`) and needs no chat-review flow.
 */
export async function loadReviewWalletContext(
  db: PrismaClient,
  walletId: string,
  caller: McpCaller,
): Promise<ReviewWalletContext> {
  if (caller.botId !== null) {
    throw new TxReviewError(
      403,
      "BOT_NOT_ALLOWED",
      "Transaction drafting through MCP is available to human wallet connections only",
    );
  }

  const walletRow = await db.wallet.findUnique({ where: { id: walletId } });
  if (!walletRow) {
    throw new TxReviewError(404, "NOT_FOUND", "Wallet not found");
  }
  if (!walletRow.signersAddresses.includes(caller.subject)) {
    // Same answer as v1WalletAuth for a non-signer: known wallet, not yours.
    throw new TxReviewError(403, "NOT_SIGNER", "Not authorized for this wallet");
  }

  const network = networkFromAddress(caller.subject);
  const wallet = walletRow as DbWalletWithLegacy;

  let walletAddress: string;
  try {
    walletAddress = resolveWalletScriptAddress(wallet, caller.subject);
  } catch (error) {
    throw new TxReviewError(
      400,
      "NO_SCRIPT",
      `This wallet's script address cannot be derived: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const appWallet = buildWallet(wallet, network);
  const multisigWallet = buildMultisigWallet(wallet, network);

  // Prefer the script whose hash matches the address — an imported wallet's
  // stored scriptCbor can be a differently encoded variant that the node
  // rejects (MissingScriptWitnessesUTXOW).
  const scriptCbor =
    resolveExpectedPaymentScriptCbor(appWallet, network) ?? appWallet.scriptCbor;
  if (!scriptCbor) {
    throw new TxReviewError(
      400,
      "NO_SCRIPT",
      "This wallet has no payment script to witness inputs with",
    );
  }

  return {
    walletRow,
    appWallet,
    multisigWallet,
    network,
    walletAddress,
    scriptCbor,
    drep: deriveDrepVoteContext(multisigWallet, appWallet),
    stake: deriveStakeCertContext(multisigWallet, appWallet),
    threshold: {
      required: getRequiredSignerCount(walletRow),
      total: walletRow.signersAddresses.length,
      type: walletRow.type,
    },
  };
}

export function toApplyDraftContext(
  ctx: ReviewWalletContext,
  availableUtxos: UTxO[],
): ApplyDraftContext {
  return {
    inputs: { kind: "script", scriptCbor: ctx.scriptCbor },
    walletAddress: ctx.walletAddress,
    availableUtxos,
    drepId: ctx.drep?.dRepId,
    drepScriptCbor: ctx.drep?.drepScriptCbor,
    stakeRewardAddress: ctx.stake?.rewardAddress,
    stakeScriptCbor: ctx.stake?.stakeScriptCbor,
  };
}
