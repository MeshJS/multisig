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

/**
 * The MCP tool registry — the single source of truth for the exposed surface.
 *
 * This release is read-only plus ballot drafts. Nothing here can sign a
 * transaction, move funds, or broadcast to chain. That is a deliberate boundary,
 * not an oversight: tool results carry user-authored strings (wallet names,
 * transaction descriptions, ballot rationales), so anything an attacker can
 * write into a wallet the caller can read is text that reaches the model. Adding
 * a write tool alongside that turns prompt injection into a funds-movement path,
 * so a signing surface needs its own design pass rather than a new registry row.
 */

export type ToolContext = {
  caller: McpCaller;
  clientIp: string;
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
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<V1Result>;
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

async function callV1(
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
