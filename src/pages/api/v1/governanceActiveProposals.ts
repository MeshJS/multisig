import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { getProvider } from "@/utils/get-provider";
import { getProposalStatus } from "@/lib/governance";

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

const getErrorStatus = (error: unknown): number | undefined => {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    (error as { response?: { status?: unknown } }).response &&
    typeof (error as { response?: { status?: unknown } }).response?.status === "number"
  ) {
    return (error as { response: { status: number } }).response.status;
  }
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    (error as { data?: { status_code?: unknown } }).data &&
    typeof (error as { data?: { status_code?: unknown } }).data?.status_code === "number"
  ) {
    return (error as { data: { status_code: number } }).data.status_code;
  }
  return undefined;
};

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

  try {
    const provider = getProvider(Number(network));
    const list = (await provider.get(
      `/governance/proposals?count=${count}&page=${page}&order=${order}`,
    )) as BlockfrostProposalListItem[];

    const active = Array.isArray(list)
      ? list.filter((item) => {
          const status = getProposalStatus({
            id: "",
            tx_hash: item.tx_hash,
            cert_index: Number(item.cert_index),
            governance_type: item.governance_type,
            deposit: "",
            return_address: "",
            governance_description: { tag: "" },
            ratified_epoch: item.ratified_epoch,
            enacted_epoch: item.enacted_epoch,
            dropped_epoch: item.dropped_epoch,
            expired_epoch: item.expired_epoch,
            expiration: null,
          });
          return status === "active";
        })
      : [];

    const proposals = await Promise.all(
      active.map(async (item) => {
        const txHash = item.tx_hash;
        const certIndex = Number(item.cert_index);
        let metadata: any = null;
        let details: any = null;

        try {
          metadata = await provider.get(`/governance/proposals/${txHash}/${certIndex}/metadata`);
        } catch (error) {
          const status = getErrorStatus(error);
          if (status !== 404) throw error;
        }

        if (includeDetails) {
          try {
            details = await provider.get(`/governance/proposals/${txHash}/${certIndex}`);
          } catch (error) {
            const status = getErrorStatus(error);
            if (status && status !== 404) throw error;
          }
        }

        const body = metadata?.json_metadata?.body ?? {};
        const authors = Array.isArray(metadata?.json_metadata?.authors)
          ? metadata.json_metadata.authors
              .map((author: any) => (typeof author?.name === "string" ? author.name : null))
              .filter((name: string | null): name is string => !!name)
          : [];

        return {
          proposalId: `${txHash}#${certIndex}`,
          txHash,
          certIndex,
          governanceType: item.governance_type,
          title: typeof body.title === "string" ? body.title : null,
          abstract: typeof body.abstract === "string" ? body.abstract : null,
          motivation: typeof body.motivation === "string" ? body.motivation : null,
          rationale: typeof body.rationale === "string" ? body.rationale : null,
          authors,
          status: "active" as const,
          details: includeDetails
            ? {
                proposedEpoch:
                  typeof details?.proposed_epoch === "number" ? details.proposed_epoch : null,
                activationEpoch:
                  typeof details?.activation_epoch === "number" ? details.activation_epoch : null,
                expiration: typeof details?.expiration === "number" ? details.expiration : null,
                deposit: typeof details?.deposit === "string" ? details.deposit : null,
                returnAddress:
                  typeof details?.return_address === "string" ? details.return_address : null,
                parameters:
                  details && typeof details === "object" && "parameters" in details
                    ? details.parameters ?? null
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
    return res.status(500).json({ error: "Failed to fetch active governance proposals" });
  }
}
