import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit, applyAddressRateLimit } from "@/lib/security/requestGuards";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { getProposalStatus } from "@/lib/governance";
import { getProviderErrorStatus } from "@/lib/server/providerErrors";
import {
  fetchProposalMetadataWithFallback,
  type ProposalMetadataProvider,
} from "@/lib/governance/proposalMetadata";
import { getGovernanceProvider, providerGet } from "@/lib/governance/provider";
import type { ProposalMetadata } from "@/types/governance";

const REQUIRED_SCOPE = "governance:read";

type BlockfrostProposalListItem = {
  tx_hash: string;
  cert_index: number | string;
  governance_type: string;
  enacted_epoch: number | null;
  dropped_epoch: number | null;
  expired_epoch: number | null;
  ratified_epoch: number | null;
};

type BlockfrostProposalDetailsItem = {
  id?: string;
  proposed_epoch?: number | null;
  activation_epoch?: number | null;
  expiration?: number | null;
  deposit?: string | null;
  return_address?: string | null;
  parameters?: unknown;
  ratified_epoch?: number | null;
  enacted_epoch?: number | null;
  dropped_epoch?: number | null;
  expired_epoch?: number | null;
};

const getErrorStatus = getProviderErrorStatus;

/** Strict integer query param: undefined → fallback, anything else must be an in-range integer. */
const parseIntParam = (
  value: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
};

/** Strict boolean query param: undefined → false, otherwise must be "true"/"false". */
const parseBoolParam = (value: string | string[] | undefined): boolean | null => {
  if (value === undefined) return false;
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);
  if (!applyRateLimit(req, res, { keySuffix: "v1/governanceActiveProposals" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  // Bot callers keep the scope check and the per-bot budget they always had.
  // Human callers are allowed through: this endpoint is a pure Blockfrost
  // passthrough over public chain data — it reads no wallet, takes no walletId,
  // and never touches signersAddresses — so there is nothing bot-specific to
  // protect. It is metered per address instead, so an authenticated human
  // cannot use it as an unbounded Blockfrost proxy.
  if (isBotJwt(payload)) {
    if (!applyBotRateLimit(req, res, payload.botId)) {
      return;
    }

    const botUser = await db.botUser.findUnique({
      where: { id: payload.botId },
      include: { botKey: true },
    });
    if (!botUser?.botKey) {
      return res.status(401).json({ error: "Bot not found" });
    }
    const scopes = parseScope(botUser.botKey.scope);
    if (!scopeIncludes(scopes, REQUIRED_SCOPE as BotScope)) {
      return res.status(403).json({ error: "Insufficient scope: governance:read required" });
    }
  } else if (!applyAddressRateLimit(req, res, payload.address)) {
    return;
  }

  const networkRaw = req.query.network;
  const network = typeof networkRaw === "string" ? networkRaw : "1";
  if (network !== "0" && network !== "1") {
    return res.status(400).json({ error: "Invalid network. Use '0' (preprod) or '1' (mainnet)." });
  }

  const count = parseIntParam(req.query.count, 100, 1, 100);
  if (count === null) {
    return res.status(400).json({ error: "Invalid count. Use an integer between 1 and 100." });
  }
  const page = parseIntParam(req.query.page, 1, 1, 10_000);
  if (page === null) {
    return res.status(400).json({ error: "Invalid page. Use an integer >= 1." });
  }
  const orderRaw = typeof req.query.order === "string" ? req.query.order : "desc";
  const order = orderRaw === "asc" ? "asc" : orderRaw === "desc" ? "desc" : null;
  if (!order) {
    return res.status(400).json({ error: "Invalid order. Use 'asc' or 'desc'." });
  }
  const includeDetails = parseBoolParam(req.query.details);
  if (includeDetails === null) {
    return res.status(400).json({ error: "Invalid details. Use 'true' or 'false'." });
  }
  const includeRatified = parseBoolParam(req.query.includeRatified);
  if (includeRatified === null) {
    return res.status(400).json({ error: "Invalid includeRatified. Use 'true' or 'false'." });
  }
  const includeDebug = parseBoolParam(req.query.debug) === true || process.env.NODE_ENV === "test";

  try {
    const provider = getGovernanceProvider(network);

    // Current epoch lets bots compute time-to-deadline from details.expiration
    // without a second data source. Best-effort — null if the lookup fails.
    let currentEpoch: number | null = null;
    try {
      const latestEpoch = await providerGet<{ epoch?: number }>({
        provider,
        network,
        path: "/epochs/latest",
      });
      currentEpoch = typeof latestEpoch?.epoch === "number" ? latestEpoch.epoch : null;
    } catch {
      // leave null
    }

    let list: BlockfrostProposalListItem[];
    try {
      list = await providerGet<BlockfrostProposalListItem[]>({
        provider,
        network,
        path: `/governance/proposals?count=${count}&page=${page}&order=${order}`,
      });
    } catch (error) {
      const status = getErrorStatus(error);
      if (status !== 404) {
        throw error;
      }
      list = [];
    }

    const statusResolved = await Promise.all(
      (Array.isArray(list) ? list : []).map(async (item) => {
        const txHash = item.tx_hash;
        const certIndex = Number(item.cert_index);
        let detailsForStatus: BlockfrostProposalDetailsItem | null = null;

        try {
          detailsForStatus = await providerGet<BlockfrostProposalDetailsItem>({
            provider,
            network,
            path: `/governance/proposals/${txHash}/${certIndex}`,
          });
        } catch (error) {
          const status = getErrorStatus(error);
          if (status && status !== 404) {
            console.warn("governanceActiveProposals details fetch failed; using list status fields", {
              txHash,
              certIndex,
              status,
            });
          }
        }

        const status = getProposalStatus({
          id: "",
          tx_hash: txHash,
          cert_index: certIndex,
          governance_type: item.governance_type,
          deposit:
            typeof detailsForStatus?.deposit === "string"
              ? detailsForStatus.deposit
              : "",
          return_address:
            typeof detailsForStatus?.return_address === "string"
              ? detailsForStatus.return_address
              : "",
          governance_description: { tag: "" },
          ratified_epoch:
            detailsForStatus?.ratified_epoch ?? item.ratified_epoch ?? null,
          enacted_epoch:
            detailsForStatus?.enacted_epoch ?? item.enacted_epoch ?? null,
          dropped_epoch:
            detailsForStatus?.dropped_epoch ?? item.dropped_epoch ?? null,
          expired_epoch:
            detailsForStatus?.expired_epoch ?? item.expired_epoch ?? null,
          expiration:
            typeof detailsForStatus?.expiration === "number"
              ? detailsForStatus.expiration
              : null,
        });

        return { item, detailsForStatus, status };
      }),
    );

    // "active" = no terminal epoch stamped on-chain. Explorers often still
    // display ratified-but-not-enacted actions as open (their outcome is
    // decided but enactment waits for the epoch boundary) — bots that want
    // those boundary cases can opt in via includeRatified=true.
    const included = statusResolved.filter(
      (entry) =>
        entry.status === "active" ||
        (includeRatified && entry.status === "ratified"),
    );

    const proposals = await Promise.all(
      included.map(async ({ item, detailsForStatus, status }) => {
        const txHash = item.tx_hash;
        const certIndex = Number(item.cert_index);
        let metadata: ProposalMetadata | null = null;
        const metadataProvider: ProposalMetadataProvider = {
          get: (path) => providerGet({ provider, network, path }),
        };

        try {
          metadata = await fetchProposalMetadataWithFallback({
            provider: metadataProvider,
            proposal: item,
            details: detailsForStatus
              ? {
                  id: detailsForStatus.id ?? "",
                  tx_hash: txHash,
                  cert_index: certIndex,
                  governance_type: item.governance_type,
                  deposit:
                    typeof detailsForStatus.deposit === "string"
                      ? detailsForStatus.deposit
                      : "",
                  return_address:
                    typeof detailsForStatus.return_address === "string"
                      ? detailsForStatus.return_address
                      : "",
                  governance_description: { tag: "" },
                  ratified_epoch: detailsForStatus.ratified_epoch ?? null,
                  enacted_epoch: detailsForStatus.enacted_epoch ?? null,
                  dropped_epoch: detailsForStatus.dropped_epoch ?? null,
                  expired_epoch: detailsForStatus.expired_epoch ?? null,
                  expiration: detailsForStatus.expiration ?? null,
                }
              : null,
          });
        } catch (error) {
          const status = getErrorStatus(error);
          if (status !== 404) {
            console.warn("governanceActiveProposals metadata fetch failed", {
              txHash,
              certIndex,
              status,
            });
          }
        }

        const body = metadata?.json_metadata.body;
        const authors =
          metadata?.json_metadata.authors.map((author) => author.name) ?? [];

        return {
          proposalId: `${txHash}#${certIndex}`,
          txHash,
          certIndex,
          governanceType: item.governance_type,
          title: body?.title ?? null,
          abstract: body?.abstract ?? null,
          motivation: body?.motivation ?? null,
          rationale: body?.rationale ?? null,
          authors,
          status,
          details: includeDetails
            ? {
                proposedEpoch:
                  typeof detailsForStatus?.proposed_epoch === "number"
                    ? detailsForStatus.proposed_epoch
                    : null,
                activationEpoch:
                  typeof detailsForStatus?.activation_epoch === "number"
                    ? detailsForStatus.activation_epoch
                    : null,
                expiration:
                  typeof detailsForStatus?.expiration === "number"
                    ? detailsForStatus.expiration
                    : null,
                deposit:
                  typeof detailsForStatus?.deposit === "string"
                    ? detailsForStatus.deposit
                    : null,
                returnAddress:
                  typeof detailsForStatus?.return_address === "string"
                    ? detailsForStatus.return_address
                    : null,
                parameters:
                  detailsForStatus &&
                  typeof detailsForStatus === "object" &&
                  "parameters" in detailsForStatus
                    ? detailsForStatus.parameters ?? null
                    : null,
              }
            : undefined,
        };
      }),
    );

    return res.status(200).json({
      proposals,
      page,
      count,
      order,
      network,
      details: includeDetails,
      includeRatified,
      currentEpoch,
      sourceCount: Array.isArray(list) ? list.length : 0,
      activeCount: proposals.length,
    });
  } catch (error) {
    const status = getErrorStatus(error);
    if (status === 429 || status === 418) {
      return res.status(503).json({
        error: "Governance provider rate-limited. Retry later.",
        retryable: true,
      });
    }
    console.error("governanceActiveProposals error:", error);
    return res.status(500).json({
      error: "Failed to fetch active governance proposals",
      ...(includeDebug
        ? {
            providerStatus: status ?? null,
            providerMessage: error instanceof Error ? error.message : String(error),
          }
        : {}),
    });
  }
}
