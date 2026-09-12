import type { NextApiHandler } from "next";

import { invokeV1, type V1Result } from "@/lib/mcp/invokeV1";
import { mintV1Token, type McpCaller } from "@/lib/mcp/auth";
import type { McpScope } from "@/lib/mcp/scopes";
import {
  ACTIVE_PROPOSALS_INPUT,
  BALLOT_UPSERT_INPUT,
  DOCUMENT_GET_INPUT,
  DOCUMENT_LIST_INPUT,
  OPEN_PROPOSALS_INPUT,
  PUBLISH_RATIONALE_INPUT,
  REVIEW_PENDING_TRANSACTION_INPUT,
  TASK_LIST_INPUT,
  TASK_PREPARE_PAYOUT_INPUT,
  TASK_UPSERT_INPUT,
  TRANSACTION_PREVIEW_INPUT,
  TRANSACTION_PROPOSE_INPUT,
  VOTE_HISTORY_INPUT,
  WALLET_BALLOTS_INPUT,
  EMPTY_INPUT,
  FREE_UTXOS_INPUT,
  LOOKUP_WALLET_INPUT,
  PROXY_DREP_INFO_INPUT,
  WALLET_ONLY_INPUT,
  type JsonSchema,
} from "@/lib/mcp/schemas";
// Pure metadata helper (its only Mesh reference is a type import), so it is
// safe to load statically without dragging the WASM into the MCP cold path.
import {
  participantsInclude,
  type Label1854LookupItem,
} from "@/utils/cip146Registration";
import { REVIEW_CARD_RESOURCE_URI } from "@/lib/mcp/apps/review-card";

/**
 * The MCP tool registry — the single source of truth for the exposed surface.
 *
 * Nothing here can sign a transaction, move funds, or broadcast to chain. That
 * is a deliberate boundary, not an oversight: tool results carry user-authored
 * strings (wallet names, transaction descriptions, ballot rationales), so
 * anything an attacker can write into a wallet the caller can read is text that
 * reaches the model. A signing tool alongside that would turn prompt injection
 * into a funds-movement path.
 *
 * What the surface CAN do beyond reading: draft ballots, pin rationales, and —
 * under the opt-in `transactions:write` scope — draft unsigned transactions in
 * two steps. `transaction_preview` builds the transaction and returns a review
 * card (PNG) plus a signed draft token; nothing is stored. `transaction_propose`
 * accepts only that token, so the pending transaction it creates is exactly
 * what the human saw in chat, and it starts with zero signatures: every witness
 * is still added by a signer in the app. See `src/lib/tx-review/`.
 */

export type ToolContext = {
  caller: McpCaller;
  clientIp: string;
};

/**
 * What a tool body returns. `status`/`body` mirror the v1 handler contract
 * (`body` becomes `structuredContent`). The optional fields exist for the
 * review tools: a readable `text` block in place of the JSON dump, `images`
 * that become `image` content blocks (base64 PNG, never placed in
 * `structuredContent`), and an `audit` bag of identifiers merged into the
 * audit row — ids only, never prose.
 */
export type McpToolResult = V1Result & {
  text?: string;
  images?: { data: string; mimeType: "image/png" }[];
  audit?: Record<string, string | number | boolean | null>;
};

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  /** Raw JSON Schema; wrapped with `fromJsonSchema` at registration time. */
  inputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /**
   * Relative path of the v1 handler this wraps, or null when the tool is served
   * from the request context alone. Asserted against the filesystem by
   * `src/__tests__/mcpTools.test.ts`, so a handler rename breaks CI.
   */
  v1Path: string | null;
  /**
   * MCP Apps: the `ui://` resource the host renders inline when this tool
   * is called (`_meta.ui.resourceUri`). Only the review tools set it.
   */
  uiResourceUri?: string;
  run: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<McpToolResult>;
};

const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const READ_ONLY_CHAIN = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * Lazy handler imports.
 *
 * These MUST stay dynamic. Several v1 handlers import `@meshsdk/core` /
 * `@meshsdk/core-csl` at module top level, which pulls the whisky WASM into
 * whatever module graph references them. Importing them statically here would
 * drag that into the MCP route's cold path — for every request, including a
 * bare `tools/list` that touches no wallet code at all.
 */
const load = {
  walletIds: () => import("@/pages/api/v1/walletIds"),
  pendingTransactions: () => import("@/pages/api/v1/pendingTransactions"),
  freeUtxos: () => import("@/pages/api/v1/freeUtxos"),
  proxies: () => import("@/pages/api/v1/proxies"),
  proxyDRepInfo: () => import("@/pages/api/v1/proxyDRepInfo"),
  lookupMultisigWallet: () => import("@/pages/api/v1/lookupMultisigWallet"),
  resolveScript: () => import("@/pages/api/v1/resolveScript"),
  governanceActiveProposals: () =>
    import("@/pages/api/v1/governanceActiveProposals"),
  botBallotsUpsert: () => import("@/pages/api/v1/botBallotsUpsert"),
  botBallots: () => import("@/pages/api/v1/botBallots"),
  drepInfo: () => import("@/pages/api/v1/drepInfo"),
  drepVotes: () => import("@/pages/api/governance/drepVotes"),
  ballotRationaleAnchor: () => import("@/pages/api/v1/ballotRationaleAnchor"),
  documents: () => import("@/pages/api/v1/documents"),
  documentDetail: () => import("@/pages/api/v1/documentDetail"),
  // The review pipeline pulls Mesh (builder, address parsing) and, on first
  // render, the next/og WASM — same lazy rule as the handlers above.
  txPreview: () => import("@/lib/tx-review/preview"),
  txPropose: () => import("@/lib/tx-review/propose"),
  txReview: () => import("@/lib/tx-review/review"),
  // Task board: the tRPC router in-process, and the payout side of the
  // same review pipeline.
  taskMcp: () => import("@/lib/task-payout/mcp"),
  taskPayoutPreview: () => import("@/lib/task-payout/preview"),
  taskPayoutHooks: () => import("@/lib/task-payout/hooks"),
  db: () => import("@/server/db"),
};

/** Vote history is two hops: resolve the wallet's DRep, then read its votes. */
async function loadVoteHistory(
  walletId: string,
  ctx: ToolContext,
): Promise<{ status: number; body: unknown }> {
  const info = await callV1(load.drepInfo, ctx, {
    method: "GET",
    query: { walletId, address: ctx.caller.subject },
  });
  const dRepId = (info.body as { dRepId?: string } | null)?.dRepId;
  if (info.status >= 400 || !dRepId) {
    return info.status >= 400
      ? info
      : { status: 400, body: { error: "This wallet has no DRep configured" } };
  }

  // Koios is queried per network, and the wallet's own address tells us which.
  const network = ctx.caller.subject.includes("test") ? "0" : "1";
  const votes = await callV1(load.drepVotes, ctx, {
    method: "GET",
    query: { drepId: dRepId, network },
  });
  return votes;
}

type VoteRow = {
  proposalId: string;
  vote: string;
  proposalTitle: string | null;
  blockTime: number;
};

export async function callV1(
  loader: () => Promise<{ default: NextApiHandler }>,
  ctx: ToolContext,
  init: {
    method: "GET" | "POST";
    query?: Record<string, string | string[] | undefined>;
    body?: unknown;
  },
): Promise<V1Result> {
  const handler = (await loader()).default;
  return invokeV1({
    handler,
    method: init.method,
    token: mintV1Token(ctx.caller, ctx.caller.subject),
    clientIp: ctx.clientIp,
    query: init.query,
    body: init.body,
  });
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * The review tools' `card` option: the PNG is rendered only on request. The
 * default leaves the card to the client's inline view (drawn from
 * `structuredContent.summary`), which reflows instead of fitting a raster.
 */
const wantsCardImage = (args: Record<string, unknown>): boolean =>
  args.card === "image";

/** JSON Schema validation has already run by the time a `run` body executes. */
export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "multisig_whoami",
    title: "Who am I",
    description:
      "Report the identity this MCP connection is acting as: the granted Cardano address(es), the approved scopes, and the connected client. Call this first when unsure which account is in play.",
    scope: "wallets:read",
    inputSchema: EMPTY_INPUT,
    annotations: READ_ONLY,
    // Served from the request context. Deliberately not a wrapper around
    // /api/v1/botMe, whose every field comes from a bot record a human has no
    // analogue for.
    v1Path: null,
    run: async (_args, ctx) => ({
      status: 200,
      body: {
        address: ctx.caller.subject,
        addresses: ctx.caller.addresses,
        scopes: ctx.caller.scopes,
        client: ctx.caller.clientName,
        identityType: ctx.caller.botId ? "bot" : "wallet",
      },
    }),
  },
  {
    name: "multisig_list_wallets",
    title: "List wallets",
    description:
      "List the multisig wallets this identity owns or has verified, with id and name. The returned walletId is what every other wallet tool takes. Wallets you have merely been named in but never accepted are NOT listed — they are reported only as a pendingInvitations count, because their names are chosen by whoever created them.",
    scope: "wallets:read",
    inputSchema: EMPTY_INPUT,
    annotations: READ_ONLY,
    v1Path: "walletIds.ts",
    run: async (_args, ctx) => {
      const result = await callV1(load.walletIds, ctx, {
        method: "GET",
        // Opt into the object shape: the bare array is the documented contract
        // for bots and dApps, so the pending count is additive rather than a
        // breaking change.
        query: { address: ctx.caller.subject, includePending: "true" },
      });
      // The endpoint answers 404 when the list is empty. "You have no wallets"
      // is a valid answer, not a failure, so it must not surface as isError.
      if (result.status === 404) {
        return { status: 200, body: { wallets: [], pendingInvitations: 0 } };
      }
      return wrapArray(result, "wallets");
    },
  },
  {
    name: "multisig_list_pending_transactions",
    title: "List pending transactions",
    description:
      "List transactions awaiting signatures for a wallet, including how many signatures each still needs.",
    scope: "wallets:read",
    inputSchema: WALLET_ONLY_INPUT,
    annotations: READ_ONLY,
    v1Path: "pendingTransactions.ts",
    run: async (args, ctx) =>
      wrapArray(
        await callV1(load.pendingTransactions, ctx, {
          method: "GET",
          query: {
            walletId: str(args.walletId),
            address: ctx.caller.subject,
          },
        }),
        "transactions",
      ),
  },
  {
    name: "multisig_list_free_utxos",
    title: "List spendable UTxOs",
    description:
      "List a wallet's UTxOs that are not already locked as inputs to a pending transaction — i.e. what is actually available to spend.",
    scope: "wallets:read",
    inputSchema: FREE_UTXOS_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "freeUtxos.ts",
    run: async (args, ctx) =>
      wrapArray(
        await callV1(load.freeUtxos, ctx, {
          method: "GET",
          query: {
            walletId: str(args.walletId),
            address: ctx.caller.subject,
            ...(args.fresh === true ? { fresh: "true" } : {}),
          },
        }),
        "utxos",
      ),
  },
  {
    name: "multisig_list_proxies",
    title: "List proxies",
    description:
      "List the active Plutus proxy scripts attached to a wallet, with their addresses and auth token ids.",
    scope: "wallets:read",
    inputSchema: WALLET_ONLY_INPUT,
    annotations: READ_ONLY,
    v1Path: "proxies.ts",
    run: async (args, ctx) =>
      wrapArray(
        await callV1(load.proxies, ctx, {
          method: "GET",
          query: {
            walletId: str(args.walletId),
            address: ctx.caller.subject,
          },
        }),
        "proxies",
      ),
  },
  {
    name: "multisig_proxy_drep_info",
    title: "Proxy DRep info",
    description:
      "Check whether a proxy's DRep credential is registered on-chain, and return its DRep id.",
    scope: "wallets:read",
    inputSchema: PROXY_DREP_INFO_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "proxyDRepInfo.ts",
    run: async (args, ctx) =>
      callV1(load.proxyDRepInfo, ctx, {
        method: "GET",
        query: {
          walletId: str(args.walletId),
          proxyId: str(args.proxyId),
          address: ctx.caller.subject,
        },
      }),
  },
  {
    name: "multisig_lookup_wallet",
    title: "Look up a multisig wallet on-chain",
    description:
      "Find on-chain CIP-1854 multisig registration metadata by participant public key hash, native-script hash (policy) or multisig wallet address. Public chain data — works for wallets this identity is not a signer of.",
    scope: "wallets:read",
    inputSchema: LOOKUP_WALLET_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "lookupMultisigWallet.ts",
    run: async (args, ctx) => {
      const hashes = Array.isArray(args.pubKeyHashes)
        ? args.pubKeyHashes.filter((h): h is string => typeof h === "string")
        : [];
      const scriptHash = str(args.scriptHash);
      const address = str(args.address);
      const network = str(args.network) ?? "1";

      const selectors = [hashes.length > 0, !!scriptHash, !!address].filter(
        Boolean,
      ).length;
      if (selectors !== 1) {
        return {
          status: 400,
          body: {
            error: "Provide exactly one of pubKeyHashes, scriptHash or address",
          },
        };
      }

      if (hashes.length > 0) {
        return wrapArray(
          await callV1(load.lookupMultisigWallet, ctx, {
            method: "GET",
            query: { pubKeyHashes: hashes.join(","), network },
          }),
          "matches",
        );
      }

      // Policy lookup: the 1854 metadata carries participants, not the
      // script hash, so resolve the script to its signer hashes first and
      // keep only registrations that list all of them.
      const resolved = await callV1(load.resolveScript, ctx, {
        method: "GET",
        query: { scriptHash, address, network },
      });
      if (resolved.status >= 400) return resolved;
      const script = resolved.body as {
        scriptHash: string;
        sigHashes: string[];
      };
      if (script.sigHashes.length === 0) {
        return {
          status: 200,
          body: {
            matches: [],
            count: 0,
            scriptHash: script.scriptHash,
            sigHashes: [],
          },
        };
      }
      const lookup = await callV1(load.lookupMultisigWallet, ctx, {
        method: "GET",
        query: { pubKeyHashes: script.sigHashes.join(","), network },
      });
      if (lookup.status >= 400 || !Array.isArray(lookup.body)) return lookup;
      const matches = (lookup.body as Label1854LookupItem[]).filter((item) =>
        participantsInclude(item, script.sigHashes),
      );
      return {
        status: 200,
        body: {
          matches,
          count: matches.length,
          scriptHash: script.scriptHash,
          sigHashes: script.sigHashes,
        },
      };
    },
  },
  {
    name: "governance_list_active_proposals",
    title: "List active governance proposals",
    description:
      "List Cardano governance proposals that are still open — not enacted, dropped, expired or ratified — with their titles and abstracts.",
    scope: "governance:read",
    inputSchema: ACTIVE_PROPOSALS_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "governanceActiveProposals.ts",
    run: async (args, ctx) =>
      callV1(load.governanceActiveProposals, ctx, {
        method: "GET",
        query: {
          network: str(args.network) ?? "1",
          count: String(typeof args.count === "number" ? args.count : 10),
          page: String(typeof args.page === "number" ? args.page : 1),
          order: str(args.order) ?? "desc",
          details: args.details === true ? "true" : "false",
        },
      }),
  },
  {
    name: "governance_list_ballots",
    title: "List governance ballots",
    description:
      "List this wallet's governance ballots — the internal record of how the signers decided on each proposal, including any drafted rationale. This is the team's own decision log, not what is recorded on-chain; use governance_vote_history for that.",
    scope: "governance:read",
    inputSchema: WALLET_BALLOTS_INPUT,
    annotations: READ_ONLY,
    v1Path: "botBallots.ts",
    run: async (args, ctx) =>
      callV1(load.botBallots, ctx, {
        method: "GET",
        query: { walletId: str(args.walletId) },
      }),
  },
  {
    name: "governance_vote_history",
    title: "On-chain vote history",
    description:
      "Votes this wallet's DRep has actually cast on-chain, newest first, with the proposal title where available. This is the settled public record; governance_list_ballots is the internal decision log that precedes it.",
    scope: "governance:read",
    inputSchema: VOTE_HISTORY_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "drepInfo.ts",
    run: async (args, ctx) => {
      const result = await loadVoteHistory(str(args.walletId) ?? "", ctx);
      if (result.status >= 400) return result;
      const body = result.body as { drepId?: string; votes?: VoteRow[] };
      const limit = typeof args.limit === "number" ? args.limit : 25;
      const votes = (body.votes ?? []).slice(0, limit);
      return {
        status: 200,
        body: { drepId: body.drepId ?? null, votes, count: votes.length },
      };
    },
  },
  {
    name: "governance_open_proposals",
    title: "Proposals still open to vote",
    description:
      "Active governance proposals this wallet has NOT yet voted on — the outstanding decisions. Cross-references live proposals against the wallet DRep's on-chain vote history. Set includeVoted to see the whole active set annotated with how this wallet voted.",
    scope: "governance:read",
    inputSchema: OPEN_PROPOSALS_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "governanceActiveProposals.ts",
    run: async (args, ctx) => {
      const network = ctx.caller.subject.includes("test") ? "0" : "1";
      const count = typeof args.count === "number" ? args.count : 10;

      const active = await callV1(load.governanceActiveProposals, ctx, {
        method: "GET",
        query: {
          network,
          count: String(count),
          page: "1",
          order: "desc",
          details: "false",
        },
      });
      if (active.status >= 400) return active;

      const proposals =
        (active.body as { proposals?: { proposalId: string }[] }).proposals ??
        [];

      // A missing DRep or a Koios hiccup must not sink the whole answer — fall
      // back to "we don't know what was voted" rather than failing the call.
      let voted = new Map<string, VoteRow>();
      let voteLookupFailed = false;
      const history = await loadVoteHistory(str(args.walletId) ?? "", ctx);
      if (history.status >= 400) {
        voteLookupFailed = true;
      } else {
        const rows = (history.body as { votes?: VoteRow[] }).votes ?? [];
        voted = new Map(rows.map((v) => [v.proposalId, v]));
      }

      const annotated = proposals.map((p) => {
        const ours = voted.get(p.proposalId);
        return {
          ...p,
          alreadyVoted: Boolean(ours),
          ourVote: ours?.vote ?? null,
        };
      });
      const includeVoted = args.includeVoted === true;
      const rows = includeVoted
        ? annotated
        : annotated.filter((p) => !p.alreadyVoted);

      return {
        status: 200,
        body: {
          proposals: rows,
          count: rows.length,
          activeConsidered: proposals.length,
          // Surfaced so the model can say "I could not check" instead of
          // implying nothing has been voted on.
          voteHistoryUnavailable: voteLookupFailed,
        },
      };
    },
  },
  {
    name: "ballot_upsert",
    title: "Create or update a ballot draft",
    description:
      "Create or update a governance ballot for a wallet: set a Yes/No/Abstain choice per proposal and draft rationale text. This is a draft only — it records no on-chain vote and submits nothing.",
    scope: "ballots:write",
    inputSchema: BALLOT_UPSERT_INPUT,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    v1Path: "botBallotsUpsert.ts",
    run: async (args, ctx) =>
      callV1(load.botBallotsUpsert, ctx, {
        method: "POST",
        body: {
          walletId: args.walletId,
          ...(args.ballotId !== undefined ? { ballotId: args.ballotId } : {}),
          ...(args.ballotName !== undefined
            ? { ballotName: args.ballotName }
            : {}),
          proposals: args.proposals,
        },
      }),
  },
  {
    name: "ballot_publish_rationale",
    title: "Publish a rationale to IPFS",
    description:
      "Publish a ballot proposal's rationale as a CIP-100/136 JSON-LD document on IPFS, and record the resulting anchor URL and hash on the ballot. Defaults to the rationale already drafted on the ballot; pass summary/rationaleStatement to override. This prepares the anchor for a vote — it does NOT cast or submit one. Submitting the vote and signing stay with the wallet's signers.",
    scope: "ballots:write",
    inputSchema: PUBLISH_RATIONALE_INPUT,
    annotations: {
      readOnlyHint: false,
      // Writes an anchor onto the ballot and pins a document, but destroys
      // nothing and casts no vote. Re-running replaces the anchor for that
      // proposal with an equivalent one.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    v1Path: "ballotRationaleAnchor.ts",
    run: async (args, ctx) =>
      callV1(load.ballotRationaleAnchor, ctx, {
        method: "POST",
        body: {
          walletId: args.walletId,
          ballotId: args.ballotId,
          proposalId: args.proposalId,
          ...(args.summary !== undefined ? { summary: args.summary } : {}),
          ...(args.rationaleStatement !== undefined
            ? { rationaleStatement: args.rationaleStatement }
            : {}),
          ...(args.precedentDiscussion !== undefined
            ? { precedentDiscussion: args.precedentDiscussion }
            : {}),
          ...(args.counterargumentDiscussion !== undefined
            ? { counterargumentDiscussion: args.counterargumentDiscussion }
            : {}),
          ...(args.conclusion !== undefined
            ? { conclusion: args.conclusion }
            : {}),
          ...(args.references !== undefined
            ? { references: args.references }
            : {}),
        },
      }),
  },
  {
    name: "document_list",
    title: "List sign-off documents",
    description:
      "List a wallet's sign-off documents with their version history: content hashes, approval counts, the threshold each round needs, and which signers have not signed yet. Read-only — approving a document requires a signature from a wallet signer and cannot be done through this tool.",
    scope: "documents:read",
    inputSchema: DOCUMENT_LIST_INPUT,
    annotations: READ_ONLY,
    v1Path: "documents.ts",
    run: async (args, ctx) =>
      wrapArray(
        await callV1(load.documents, ctx, {
          method: "GET",
          query: {
            walletId: String(args.walletId),
            address: ctx.caller.subject,
            ...(args.includeArchived ? { includeArchived: "true" } : {}),
          },
        }),
        "documents",
      ),
  },
  {
    name: "document_get",
    title: "Get a sign-off document",
    description:
      "Get one sign-off document by id: every version with its content hash and status, who approved or rejected each one, and the document's audit history. Read-only.",
    scope: "documents:read",
    inputSchema: DOCUMENT_GET_INPUT,
    annotations: READ_ONLY,
    v1Path: "documentDetail.ts",
    run: async (args, ctx) =>
      callV1(load.documentDetail, ctx, {
        method: "GET",
        query: {
          documentId: String(args.documentId),
          address: ctx.caller.subject,
        },
      }),
  },
  {
    name: "transaction_preview",
    title: "Preview an unsigned transaction",
    description:
      "Build an unsigned multisig transaction — payments in ADA and native assets, staking certificates, DRep votes — for the user to check in chat. The result is the review card: by default the client's inline card view draws it next to this call, with a Confirm button the user may click (you will be told) instead of replying; if the user cannot see a card, relay the summary in the same turn, then ask them to confirm. Pass card: \"image\" when the user wants a picture of the card (or this client shows images but not inline views) and show the returned image in your reply. NOTHING is saved, signed or broadcast. Only after the user confirms, call transaction_propose with the returned draftToken. Amounts are in display units (ADA, not lovelace). Change always returns to the wallet itself. Votes need the wallet to be registered as a DRep on chain; if it is not, the draft is refused and you must tell the user the wallet cannot vote until it registers as a DRep in the app.",
    scope: "transactions:write",
    inputSchema: TRANSACTION_PREVIEW_INPUT,
    annotations: {
      // Builds in memory against live chain state and stores nothing.
      readOnlyHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    v1Path: null,
    uiResourceUri: REVIEW_CARD_RESOURCE_URI,
    run: async (args, ctx) => {
      const [{ runTransactionPreview }, { db }] = await Promise.all([
        load.txPreview(),
        load.db(),
      ]);
      return runTransactionPreview(args as never, ctx, {
        db,
        omitCard: !wantsCardImage(args),
        fetchFreeUtxos: (walletId) =>
          callV1(load.freeUtxos, ctx, {
            method: "GET",
            query: { walletId, address: ctx.caller.subject, fresh: "true" },
          }),
      });
    },
  },
  {
    name: "transaction_propose",
    title: "Create the previewed transaction for signers",
    description:
      "Create the pending multisig transaction that transaction_preview showed, so the wallet's signers can review and sign it in the app. Takes ONLY the draftToken from the preview the user approved — it is rebuilt from that exact draft, starts with zero signatures, and is never signed or broadcast by this tool. The result is the final review card, delivered the same way the preview was (inline card view by default; as an image when the preview used card: \"image\" — then show that image in your reply). Any vote rationale in the draft is published to IPFS at this point. Calling again with the same token returns the same transaction.",
    scope: "transactions:write",
    inputSchema: TRANSACTION_PROPOSE_INPUT,
    annotations: {
      readOnlyHint: false,
      // Adds a pending row; deletes nothing, moves no value, signs nothing.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    v1Path: null,
    uiResourceUri: REVIEW_CARD_RESOURCE_URI,
    run: async (args, ctx) => {
      const [{ runTransactionPropose }, { withTaskPayoutHooks }, { db }] =
        await Promise.all([load.txPropose(), load.taskPayoutHooks(), load.db()]);
      // A token minted by task_prepare_payout carries the task ids; the hooks
      // link them to the created transaction. Other tokens pass through.
      return runTransactionPropose(
        { draftToken: String(args.draftToken ?? "") },
        ctx,
        withTaskPayoutHooks({
          db,
          clientIp: ctx.clientIp,
          fetchFreeUtxos: (walletId) =>
            callV1(load.freeUtxos, ctx, {
              method: "GET",
              query: { walletId, address: ctx.caller.subject, fresh: "true" },
            }),
        }),
      );
    },
  },
  {
    name: "multisig_review_pending_transaction",
    title: "Review a pending transaction",
    description:
      "Render one pending transaction as a review card: recipients and amounts, staking or governance actions, fee, change, and who has signed or rejected so far. By default the client's inline card view draws the card next to this call; if the user cannot see it, relay the summary. Pass card: \"image\" for a picture of the card and show the returned image in your reply rather than paraphrasing it. Read-only; works for transactions created in the app or through MCP.",
    scope: "wallets:read",
    inputSchema: REVIEW_PENDING_TRANSACTION_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "pendingTransactions.ts",
    uiResourceUri: REVIEW_CARD_RESOURCE_URI,
    run: async (args, ctx) => {
      const [{ runPendingTransactionReview }, { db }] = await Promise.all([
        load.txReview(),
        load.db(),
      ]);
      return runPendingTransactionReview(
        {
          walletId: String(args.walletId),
          transactionId: String(args.transactionId),
        },
        ctx,
        {
          db,
          omitCard: !wantsCardImage(args),
          fetchFreeUtxos: () =>
            Promise.resolve({ status: 200, body: [] }),
          fetchPendingTransactions: (walletId) =>
            callV1(load.pendingTransactions, ctx, {
              method: "GET",
              query: { walletId, address: ctx.caller.subject },
            }),
        },
      );
    },
  },
  {
    name: "task_list",
    title: "List project tasks",
    description:
      "The wallet's project task board: every task with its column (Backlog, InProgress, InReview, Done), assignee, due date, payment recipients (amounts in base units: lovelace, or a token's raw quantity) and payout state — none, ready (has recipients, not yet paid), pending (a payout transaction awaits signatures; includes its transactionId) or paid. Optionally filter by column.",
    scope: "wallets:read",
    inputSchema: TASK_LIST_INPUT,
    annotations: READ_ONLY,
    v1Path: null,
    run: async (args, ctx) => {
      const { runTaskList } = await load.taskMcp();
      return runTaskList(
        { walletId: String(args.walletId), status: str(args.status) },
        ctx,
      );
    },
  },
  {
    name: "task_upsert",
    title: "Create, edit or move a task",
    description:
      "Create a task on the wallet's board (title required) or update an existing one by taskId: title, description, priority, assignee, due date, column (status) and position, and its payment recipients in display units (ADA, or a token with its registered decimals — the same shape as transaction_preview outputs). Recipients replace the task's existing ones and are locked while a payout is awaiting signatures. This records a task only; it creates, signs and broadcasts nothing — use task_prepare_payout to draft the payout.",
    scope: "tasks:write",
    inputSchema: TASK_UPSERT_INPUT,
    annotations: {
      readOnlyHint: false,
      // Adds or edits a board row; never removes a task, never moves value.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    v1Path: null,
    run: async (args, ctx) => {
      const { runTaskUpsert } = await load.taskMcp();
      return runTaskUpsert(args as never, ctx);
    },
  },
  {
    name: "task_prepare_payout",
    title: "Preview a payout for tasks",
    description:
      "Build the unsigned transaction that pays one or more tasks' recipients (merged per address) against the wallet's spendable UTxOs, and show it. Nothing is stored, signed or sent. The result is the review card: the client's inline card view draws it next to this call (with a Confirm button); if the user cannot see it, relay the summary, or pass card: \"image\" for a picture and show the returned image. Ask the user to confirm; on confirmation call transaction_propose with the returned draftToken — the tasks are linked to the pending transaction automatically and show as awaiting signatures on the board. The token expires in 15 minutes and is bound to exactly these tasks and amounts.",
    scope: "transactions:write",
    inputSchema: TASK_PREPARE_PAYOUT_INPUT,
    annotations: {
      // Builds in memory against live chain state and stores nothing.
      readOnlyHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    v1Path: null,
    uiResourceUri: REVIEW_CARD_RESOURCE_URI,
    run: async (args, ctx) => {
      const [{ prepareTaskPayoutPreview }, { db }] = await Promise.all([
        load.taskPayoutPreview(),
        load.db(),
      ]);
      const taskIds = Array.isArray(args.taskIds)
        ? args.taskIds.map((id) => String(id))
        : [];
      return prepareTaskPayoutPreview(
        { walletId: String(args.walletId), taskIds },
        ctx,
        {
          db,
          omitCard: !wantsCardImage(args),
          fetchFreeUtxos: (walletId) =>
            callV1(load.freeUtxos, ctx, {
              method: "GET",
              query: { walletId, address: ctx.caller.subject, fresh: "true" },
            }),
        },
      );
    },
  },
];

/**
 * Several v1 endpoints answer with a bare top-level array. That is legal JSON but
 * a poor `structuredContent` payload — it cannot carry sibling fields and reads
 * badly in a tool result — so name it.
 */
function wrapArray(result: V1Result, key: string): V1Result {
  if (result.status >= 400 || !Array.isArray(result.body)) return result;
  return {
    status: result.status,
    body: { [key]: result.body, count: result.body.length },
  };
}

export function toolsForScopes(scopes: readonly McpScope[]): McpToolDef[] {
  return MCP_TOOLS.filter((tool) => scopes.includes(tool.scope));
}
