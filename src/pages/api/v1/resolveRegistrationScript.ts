import type { NextApiRequest, NextApiResponse } from "next";
import { deserializeAddress } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { isProviderNotFoundError } from "@/lib/server/providerErrors";

export type RegistrationScriptCandidate = {
  address: string;
  scriptHash: string;
  stakeCredentialHash: string | null;
  scriptJson: unknown;
};

export type ResolveRegistrationScriptResponse = {
  txHash: string;
  candidates: RegistrationScriptCandidate[];
};

/**
 * Resolves the native script(s) of a CIP-0146 registration transaction.
 *
 * The 1854 metadata carries participants and types but not the script
 * itself (threshold, policy). A registration created by this app
 * self-spends from the multisig address, so the script-credential
 * address appears in the transaction's UTxOs and the timelock JSON is
 * indexed by the provider under /scripts/{hash}/json. Each candidate is
 * a distinct script-payment address seen in the transaction; the client
 * picks the one whose sig key hashes match the registration's
 * participants.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (
    !applyRateLimit(req, res, {
      keySuffix: "v1/resolveRegistrationScript",
      maxRequests: 30,
    })
  ) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { txHash, network = "1" } = req.query;

  if (typeof txHash !== "string" || !/^[0-9a-f]{64}$/i.test(txHash)) {
    return res
      .status(400)
      .json({ error: "Missing or invalid txHash parameter" });
  }

  const networkId = parseInt(network as string, 10);
  if (networkId !== 0 && networkId !== 1) {
    return res.status(400).json({ error: "Invalid network (expected 0 or 1)" });
  }

  const provider = getProvider(networkId);
  const normalizedTxHash = txHash.toLowerCase();

  try {
    const utxoInfo = await provider.get(`/txs/${normalizedTxHash}/utxos`);
    const outputs: { address?: string }[] = Array.isArray(utxoInfo?.outputs)
      ? utxoInfo.outputs
      : [];
    const inputs: { address?: string }[] = Array.isArray(utxoInfo?.inputs)
      ? utxoInfo.inputs
      : [];

    // Outputs first: a self-spend registration always pays change back to
    // the multisig address. Inputs cover txs that only spent from it.
    const addresses = Array.from(
      new Set(
        [...outputs, ...inputs]
          .map((entry) => entry?.address)
          .filter((addr): addr is string => typeof addr === "string"),
      ),
    );

    const seenScriptHashes = new Set<string>();
    const candidates: RegistrationScriptCandidate[] = [];

    for (const address of addresses) {
      let scriptHash: string | undefined;
      let stakeCredentialHash: string | null = null;
      try {
        const parts = deserializeAddress(address);
        scriptHash = parts.scriptHash || undefined;
        stakeCredentialHash =
          parts.stakeScriptCredentialHash || parts.stakeCredentialHash || null;
      } catch {
        continue;
      }
      if (!scriptHash || seenScriptHashes.has(scriptHash)) continue;
      seenScriptHashes.add(scriptHash);

      try {
        const scriptInfo = await provider.get(`/scripts/${scriptHash}/json`);
        if (!scriptInfo?.json) continue; // Plutus or unavailable
        candidates.push({
          address,
          scriptHash,
          stakeCredentialHash,
          scriptJson: scriptInfo.json,
        });
      } catch (error) {
        if (isProviderNotFoundError(error)) continue;
        throw error;
      }
    }

    // Script content is immutable per tx hash — cache aggressively.
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=600",
    );
    const response: ResolveRegistrationScriptResponse = {
      txHash: normalizedTxHash,
      candidates,
    };
    res.status(200).json(response);
  } catch (error) {
    if (isProviderNotFoundError(error)) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=120",
      );
      return res
        .status(200)
        .json({ txHash: normalizedTxHash, candidates: [] });
    }
    console.error("resolveRegistrationScript error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
