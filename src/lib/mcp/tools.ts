import type { NextApiHandler } from "next";

import { invokeV1, type V1Result } from "@/lib/mcp/invokeV1";
import { mintV1Token, type McpCaller } from "@/lib/mcp/auth";
import type { McpScope } from "@/lib/mcp/scopes";
import {
  ACTIVE_PROPOSALS_INPUT,
  BALLOT_UPSERT_INPUT,
  EMPTY_INPUT,
  FREE_UTXOS_INPUT,
  LOOKUP_WALLET_INPUT,
  PROXY_DREP_INFO_INPUT,
  WALLET_ONLY_INPUT,
  type JsonSchema,
} from "@/lib/mcp/schemas";

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

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const READ_ONLY_CHAIN = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

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
  governanceActiveProposals: () =>
    import("@/pages/api/v1/governanceActiveProposals"),
  botBallotsUpsert: () => import("@/pages/api/v1/botBallotsUpsert"),
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
      "List every multisig wallet this identity can see, with its id and name. The returned walletId is what every other wallet tool takes.",
    scope: "wallets:read",
    inputSchema: EMPTY_INPUT,
    annotations: READ_ONLY,
    v1Path: "walletIds.ts",
    run: async (_args, ctx) => {
      const result = await callV1(load.walletIds, ctx, {
        method: "GET",
        query: { address: ctx.caller.subject },
      });
      // The endpoint answers 404 when the list is empty. "You have no wallets"
      // is a valid answer, not a failure, so it must not surface as isError.
      if (result.status === 404) {
        return { status: 200, body: { wallets: [] } };
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
      "Find on-chain CIP-1854 multisig registration metadata by participant public key hash. Public chain data — works for wallets this identity is not a signer of.",
    scope: "wallets:read",
    inputSchema: LOOKUP_WALLET_INPUT,
    annotations: READ_ONLY_CHAIN,
    v1Path: "lookupMultisigWallet.ts",
    run: async (args, ctx) => {
      const hashes = Array.isArray(args.pubKeyHashes)
        ? args.pubKeyHashes.filter((h): h is string => typeof h === "string")
        : [];
      return wrapArray(
        await callV1(load.lookupMultisigWallet, ctx, {
          method: "GET",
          query: {
            pubKeyHashes: hashes.join(","),
            network: str(args.network) ?? "1",
          },
        }),
        "matches",
      );
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
