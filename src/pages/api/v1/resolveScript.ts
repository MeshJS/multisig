import type { NextApiRequest, NextApiResponse } from "next";
import { deserializeAddress } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { isProviderNotFoundError } from "@/lib/server/providerErrors";
import {
  collectNativeScriptSigHashes,
  providerScriptJsonToNativeScript,
} from "@/utils/nativeScriptJson";

export type ResolveScriptResponse = {
  scriptHash: string;
  /** Stake credential of the queried address (null when queried by hash). */
  stakeCredentialHash: string | null;
  /** Provider timelock JSON, or null when unknown / not a native script. */
  scriptJson: unknown | null;
  /** Sig key hashes in script order (empty when unresolved or non-timelock). */
  sigHashes: string[];
};

const SCRIPT_HASH_RE = /^[0-9a-f]{56}$/i;

/**
 * Resolves a native script by its hash ("policy") or by a multisig
 * (script-credential) address, returning its sig key hashes.
 *
 * Backs "lookup by policy" on the Discover tab: the label-1854
 * registration metadata carries participants but not the script hash,
 * so a policy query is answered by resolving the script to its signer
 * hashes and then matching those against registrations. Public chain
 * data, unauthenticated, rate-limited like its sibling routes.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (
    !applyRateLimit(req, res, {
      keySuffix: "v1/resolveScript",
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

  const { scriptHash: rawScriptHash, address, network = "1" } = req.query;

  const hasHash = typeof rawScriptHash === "string" && rawScriptHash.length > 0;
  const hasAddress = typeof address === "string" && address.length > 0;
  if (hasHash === hasAddress) {
    return res
      .status(400)
      .json({ error: "Provide exactly one of scriptHash or address" });
  }

  const networkId = parseInt(network as string, 10);
  if (networkId !== 0 && networkId !== 1) {
    return res.status(400).json({ error: "Invalid network (expected 0 or 1)" });
  }

  let scriptHash: string;
  let stakeCredentialHash: string | null = null;
  if (hasHash) {
    if (!SCRIPT_HASH_RE.test(rawScriptHash as string)) {
      return res.status(400).json({ error: "Invalid scriptHash parameter" });
    }
    scriptHash = (rawScriptHash as string).toLowerCase();
  } else {
    let parts: ReturnType<typeof deserializeAddress>;
    try {
      parts = deserializeAddress(address as string);
    } catch {
      return res.status(400).json({ error: "Invalid address parameter" });
    }
    if (!parts.scriptHash) {
      return res
        .status(400)
        .json({ error: "Address is not a multisig (script) address" });
    }
    scriptHash = parts.scriptHash.toLowerCase();
    stakeCredentialHash =
      parts.stakeScriptCredentialHash || parts.stakeCredentialHash || null;
  }

  const provider = getProvider(networkId);
  const empty: ResolveScriptResponse = {
    scriptHash,
    stakeCredentialHash,
    scriptJson: null,
    sigHashes: [],
  };

  try {
    const scriptInfo = await provider.get(`/scripts/${scriptHash}/json`);
    if (!scriptInfo?.json) {
      // Plutus script or provider without timelock JSON.
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=120",
      );
      return res.status(200).json(empty);
    }

    let sigHashes: string[] = [];
    try {
      sigHashes = collectNativeScriptSigHashes(
        providerScriptJsonToNativeScript(scriptInfo.json),
      );
    } catch {
      // Unsupported script shape — still surface the JSON, no signers.
      sigHashes = [];
    }

    // Script content is immutable per hash — cache aggressively.
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=600",
    );
    const response: ResolveScriptResponse = {
      scriptHash,
      stakeCredentialHash,
      scriptJson: scriptInfo.json,
      sigHashes,
    };
    return res.status(200).json(response);
  } catch (error) {
    if (isProviderNotFoundError(error)) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=120",
      );
      return res.status(200).json(empty);
    }
    console.error("resolveScript error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
