import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { getProvider } from "@/utils/get-provider";
import { getProposalStatus } from "@/lib/governance";
import { getProviderErrorStatus } from "@/lib/server/providerErrors";
import {
  fetchProposalMetadataWithFallback,
  type ProposalMetadataProvider,
} from "@/lib/governance/proposalMetadata";
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

const getBlockfrostConfig = (network: string): { key: string; baseUrl: string } | null => {
  const key =
    network === "0"
      ? process.env.BLOCKFROST_API_KEY_PREPROD || process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : process.env.BLOCKFROST_API_KEY_MAINNET || process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
  if (!key?.trim()) return null;
  return {
    key,
    baseUrl:
      network === "0"
        ? "https://cardano-preprod.blockfrost.io/api/v0"
        : "https://cardano-mainnet.blockfrost.io/api/v0",
  };
};

const blockfrostGet = async <T,>(network: string, path: string): Promise<T> => {
  const config = getBlockfrostConfig(network);
  if (!config) {
    throw new Error(`Missing Blockfrost API key for network ${network}`);
  }
  const response = await fetch(`${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    headers: {
      project_id: config.key,
      accept: "application/json",
    },
  });
  const text = await response.text();
  const body = text
    ? (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      })()
    : null;

  if (!response.ok) {
    throw {
      status: response.status,
      data: typeof body === "object" && body !== null ? body : { message: String(body ?? "") },
    };
  }

  return body as T;
};

const providerGet = async <T,>(args: {
  provider: { get: (path: string) => Promise<unknown> } | null;
  network: string;
  path: string;
}): Promise<T> => {
  if (!args.provider) {
    return blockfrostGet<T>(args.network, args.path);
  }

  try {
    return (await args.provider.get(args.path)) as T;
  } catch (error) {
    const status = getProviderErrorStatus(error);
    if (status !== undefined) {
      throw error;
    }
    console.warn("governanceActiveProposals provider.get failed; retrying via Blockfrost REST", {
      path: args.path,
      message: error instanceof Error ? error.message : String(error),
    });
    return blockfrostGet<T>(args.network, args.path);
  }
};

const getGovernanceProvider = (network: string): { get: (path: string) => Promise<unknown> } | null => {
  try {
    return getProvider(Number(network));
  } catch (error) {
    console.warn("governanceActiveProposals getProvider failed; using Blockfrost REST", {
      network,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const getErrorStatus = getProviderErrorStatus;

const toInt = (value: string | string[] | undefined, fallback: number): number => {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const isBoolQueryTrue = (value: string | string[] | undefined): boolean =>
  typeof value === "string" && value.toLowerCase() === "true";

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
    return res.status(401).json({ error: "Unauthorized - Missing token" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  if (!isBotJwt(payload)) {
    return res.status(403).json({ error: "Only bot tokens can access this endpoint" });
  }
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

  const networkRaw = req.query.network;
  const network = typeof networkRaw === "string" ? networkRaw : "1";
  if (network !== "0" && network !== "1") {
    return res.status(400).json({ error: "Invalid network. Use '0' (preprod) or '1' (mainnet)." });
  }

  const count = Math.min(toInt(req.query.count, 100), 100);
  const page = toInt(req.query.page, 1);
  const orderRaw = typeof req.query.order === "string" ? req.query.order : "desc";
  const order = orderRaw === "asc" ? "asc" : orderRaw === "desc" ? "desc" : null;
  if (!order) {
    return res.status(400).json({ error: "Invalid order. Use 'asc' or 'desc'." });
  }
  const includeDetails = isBoolQueryTrue(req.query.details);
  const includeDebug = isBoolQueryTrue(req.query.debug) || process.env.NODE_ENV === "test";

  try {
    const provider = getGovernanceProvider(network);
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

    const active = statusResolved.filter((entry) => entry.status === "active");

    const proposals = await Promise.all(
      active.map(async ({ item, detailsForStatus }) => {
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
          status: "active" as const,
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
