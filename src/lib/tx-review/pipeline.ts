import type { PrismaClient } from "@prisma/client";
import type { UTxO } from "@meshsdk/core";

import type { V1Result } from "@/lib/mcp/invokeV1";
import { completeTxWithFreshCostModels } from "@/lib/completeTxWithFreshCostModels";
import { fetchDrepStatus } from "@/lib/governance/drep-status";
import { fetchStakeAccountStatus } from "@/lib/staking/stake-account-status";
import { utxoFunds } from "@/lib/tx-draft/assets";
import { buildDraftTx, type DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import { validateDraft, type DraftIssue } from "@/lib/tx-draft/validate";
import type { TxDraft } from "@/types/tx-draft";
import { getProvider } from "@/utils/get-provider";
import { getTxBuilder } from "@/utils/get-tx-builder";

import { loadContacts, createServerAddressLabeler } from "./labels";
import {
  resolveAssetMetadata,
  resolvePoolNames,
  resolveProposalTitles,
  type ResolvedAssetMetadata,
} from "./metadata";
import { renderReviewPng } from "./render-png";
import { collectSpecUnits, type TxSpec } from "./spec";
import {
  summarizeMeshBody,
  type SummarizeOptions,
  type TxReviewSummary,
} from "./summary";
import { TxReviewError, toApplyDraftContext, type ReviewWalletContext } from "./context";

/**
 * The steps preview and propose share, in the order they must happen:
 * spendable UTxOs → asset metadata → validation → build → summary → card.
 * Both callers hand in the same spec (propose gets it from the token), so
 * the only way the two transactions differ is what changed on chain in
 * between — which the propose result reports.
 */

export type ReviewDeps = {
  db: PrismaClient;
  /** `multisig_list_free_utxos`'s v1 handler, run in-process for the caller. */
  fetchFreeUtxos: (walletId: string) => Promise<V1Result>;
  /** Injectable for tests; defaults to the real renderer. */
  renderPng?: (summary: TxReviewSummary) => Promise<Buffer>;
};

/** UTxOs not locked by another pending transaction, fresh from chain. */
export async function loadSpendableUtxos(
  deps: ReviewDeps,
  walletId: string,
): Promise<UTxO[]> {
  const result = await deps.fetchFreeUtxos(walletId);
  if (result.status >= 400) {
    const error = (result.body as { error?: string } | null)?.error;
    throw new TxReviewError(
      result.status,
      "UTXO_LOOKUP_FAILED",
      error ?? "Could not load the wallet's spendable UTxOs",
    );
  }
  return Array.isArray(result.body) ? (result.body as UTxO[]) : [];
}

export async function loadSpecAssetMetadata(
  spec: TxSpec,
  network: 0 | 1,
): Promise<ResolvedAssetMetadata> {
  const units = collectSpecUnits({ walletId: spec.walletId, outputs: spec.outputs.map((o) => ({
    address: o.address,
    assets: o.assets.filter((a) => a.unit !== "lovelace").map((a) => ({ unit: a.unit, quantity: a.quantity })),
  })) });
  return resolveAssetMetadata(getProvider(network), units, network);
}

/** Validation errors become a 400 with the issue list; warnings are returned. */
export function validateOrThrow(
  draft: TxDraft,
  ctx: ReviewWalletContext,
  availableUtxos: UTxO[],
  stakeAccountActive?: boolean,
  drepRegistered?: boolean,
): DraftIssue[] {
  const issues = validateDraft(draft, {
    network: ctx.network,
    selectedFunds: utxoFunds(availableUtxos),
    hasDrepContext: !!ctx.drep,
    hasStakeContext: !!ctx.stake,
    stakeAccountActive,
    drepRegistered,
    multisigAddress: ctx.walletAddress,
  });
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) {
    throw new TxReviewError(
      400,
      "INVALID_DRAFT",
      `The transaction cannot be built: ${errors.map((e) => e.message).join(" ")}`,
      { issues },
    );
  }
  return issues.filter((issue) => issue.level === "warning");
}

/**
 * Registration state of the wallet's stake credential, fetched only when the
 * spec carries certificates. A delegation for an unregistered credential
 * (or a registration for a registered one) builds fine and is rejected by
 * the node at submit — after the signatures are in — so the state must be
 * known before validation. Returns undefined when there is nothing to check.
 */
export async function loadStakeAccountActive(
  ctx: ReviewWalletContext,
  spec: { certificates: readonly unknown[] },
): Promise<boolean | undefined> {
  if (spec.certificates.length === 0 || !ctx.stake) return undefined;
  try {
    const status = await fetchStakeAccountStatus(
      getProvider(ctx.network),
      ctx.stake.rewardAddress,
    );
    return status.active;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TxReviewError(
      502,
      "STAKE_LOOKUP_FAILED",
      `Could not check whether the wallet's stake credential is registered: ${message.slice(0, 200)}`,
    );
  }
}

/**
 * Registration state of the wallet's DRep credential, fetched only when the
 * spec carries votes. A vote from an unregistered DRep builds fine and is
 * rejected by the node at submit — after the signatures are in — so the
 * state must be known before validation, which then refuses the draft
 * (`vote-drep-unregistered`) and tells the user to register first. Returns
 * undefined when there is nothing to check; a wallet with no DRep identity
 * at all is `vote-drep-missing`'s job.
 */
export async function loadDrepRegistered(
  ctx: ReviewWalletContext,
  spec: { votes: readonly unknown[] },
): Promise<boolean | undefined> {
  if (spec.votes.length === 0 || !ctx.drep) return undefined;
  try {
    const status = await fetchDrepStatus(getProvider(ctx.network), ctx.drep.dRepId);
    return status.active;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TxReviewError(
      502,
      "DREP_LOOKUP_FAILED",
      `Could not check whether the wallet is registered as a DRep: ${message.slice(0, 200)}`,
    );
  }
}

export const STAKE_REGISTRATION_ADDED_WARNING =
  "The wallet's stake credential is not registered on chain, so a stake registration (2 ADA deposit, refundable on deregistration) was added ahead of the delegation.";

/**
 * A delegation for an unregistered credential gets its registration added,
 * the way the builder canvas offers only register+delegate for an inactive
 * account. Done on the spec, not the draft, so the token minted from it
 * records the registration and its deposit exactly as the card showed them:
 * propose rebuilds from that spec, and if the account was registered in the
 * meantime, validation refuses (`cert-already-registered`) rather than
 * quietly dropping a deposit the human confirmed.
 */
export function ensureStakeRegistration(
  spec: TxSpec,
  stakeAccountActive: boolean | undefined,
): { spec: TxSpec; added: boolean } {
  if (stakeAccountActive !== false) return { spec, added: false };
  const kinds = new Set(spec.certificates.map((cert) => cert.kind));
  if (!kinds.has("DelegateStake") || kinds.has("RegisterStake")) {
    return { spec, added: false };
  }
  return {
    spec: {
      ...spec,
      certificates: [{ kind: "RegisterStake" }, ...spec.certificates],
    },
    added: true,
  };
}

export async function buildUnsigned(
  draft: TxDraft,
  ctx: ReviewWalletContext,
  availableUtxos: UTxO[],
): Promise<DraftBuildResult> {
  try {
    // Always a fresh builder: MeshTxBuilder is stateful and single-use.
    const txBuilder = await getTxBuilder(ctx.network);
    return await buildDraftTx(txBuilder, draft, toApplyDraftContext(ctx, availableUtxos), {
      metadataMessage: draft.metadata || undefined,
      complete: (builder) => completeTxWithFreshCostModels(builder, ctx.network),
    });
  } catch (error) {
    if (error instanceof TxReviewError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TxReviewError(
      400,
      "BUILD_FAILED",
      `Building the transaction failed: ${message.slice(0, 400)}`,
    );
  }
}

export type SummaryInputs = Pick<
  SummarizeOptions,
  | "kind"
  | "signedAddresses"
  | "rejectedAddresses"
  | "description"
  | "metadataMessage"
  | "pendingRationales"
  | "paymentCount"
  | "txHash"
  | "transactionId"
  | "sizeBytes"
  | "warnings"
>;

/** Resolve labels, names and titles, then summarize one builder body. */
export async function summarizeForWallet(
  deps: ReviewDeps,
  body: any,
  wallet: {
    id: string;
    name: string;
    address: string;
    network: 0 | 1;
    signersAddresses: string[];
    signersDescriptions: string[];
    threshold: SummarizeOptions["threshold"];
  },
  assets: ResolvedAssetMetadata | undefined,
  inputs: SummaryInputs,
): Promise<TxReviewSummary> {
  const provider = getProvider(wallet.network);

  const outputUnits = new Set<string>();
  for (const output of Array.isArray(body?.outputs) ? body.outputs : []) {
    for (const asset of Array.isArray(output?.amount) ? output.amount : []) {
      if (asset?.unit && asset.unit !== "lovelace") outputUnits.add(asset.unit);
    }
  }
  const missingUnits = [...outputUnits].filter((unit) => !assets?.metadata[unit]);
  const extra =
    missingUnits.length > 0
      ? await resolveAssetMetadata(provider, missingUnits, wallet.network)
      : undefined;
  const assetMetadata = { ...(assets?.metadata ?? {}), ...(extra?.metadata ?? {}) };

  const poolIds: string[] = [];
  for (const cert of Array.isArray(body?.certificates) ? body.certificates : []) {
    const poolId = cert?.certType?.poolId;
    if (cert?.certType?.type === "DelegateStake" && typeof poolId === "string") {
      poolIds.push(poolId);
    }
  }
  const proposalIds: string[] = [];
  for (const vote of Array.isArray(body?.votes) ? body.votes : []) {
    const id = vote?.vote?.govActionId;
    if (id?.txHash !== undefined && id?.txIndex !== undefined) {
      proposalIds.push(`${id.txHash}#${id.txIndex}`);
    }
  }

  const [contacts, resolvePoolName, resolveProposalTitle] = await Promise.all([
    loadContacts(deps.db, wallet.id),
    poolIds.length > 0 ? resolvePoolNames(provider, poolIds) : Promise.resolve(undefined),
    proposalIds.length > 0
      ? resolveProposalTitles(deps.db, provider, wallet.id, proposalIds)
      : Promise.resolve(undefined),
  ]);

  return summarizeMeshBody(body, {
    ...inputs,
    wallet: {
      id: wallet.id,
      name: wallet.name,
      address: wallet.address,
      network: wallet.network,
    },
    threshold: wallet.threshold,
    labelAddress: createServerAddressLabeler({
      walletAddress: wallet.address,
      signersAddresses: wallet.signersAddresses,
      signersDescriptions: wallet.signersDescriptions,
      contacts,
    }),
    assetMetadata,
    resolvePoolName,
    resolveProposalTitle,
  });
}

export async function renderCard(
  deps: ReviewDeps,
  summary: TxReviewSummary,
): Promise<{ data: string; mimeType: "image/png" }> {
  const png = await (deps.renderPng ?? renderReviewPng)(summary);
  return { data: png.toString("base64"), mimeType: "image/png" };
}

export function walletSummaryShape(ctx: ReviewWalletContext) {
  return {
    id: ctx.walletRow.id,
    name: ctx.walletRow.name,
    address: ctx.walletAddress,
    network: ctx.network,
    signersAddresses: ctx.walletRow.signersAddresses,
    signersDescriptions: ctx.walletRow.signersDescriptions,
    threshold: ctx.threshold,
  };
}

/** Rationale text per proposal id, for the preview's "will publish" note. */
export function pendingRationalesOf(spec: TxSpec): Map<string, string> {
  const map = new Map<string, string>();
  for (const vote of spec.votes) {
    if (vote.rationale) {
      map.set(`${vote.govActionTxHash}#${vote.govActionIndex}`, vote.rationale);
    }
  }
  return map;
}

export function issueMessages(issues: DraftIssue[]): string[] {
  return issues.map((issue) => issue.message);
}
