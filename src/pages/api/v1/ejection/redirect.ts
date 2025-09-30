import type { NextApiRequest, NextApiResponse } from "next";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { validateMultisigImportPayload } from "@/utils/validateMultisigImport";
import { db } from "@/server/db";
import { addressToNetwork } from "@/utils/multisigSDK";
import { getProvider } from "@/utils/get-provider";

// Draft endpoint: accepts POST request values and logs them
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse,
) {
    // Add cache-busting headers for CORS
    addCorsCacheBustingHeaders(res);

    await cors(req, res);
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const receivedAt = new Date().toISOString();
        const origin = req.headers.origin ?? null;
        const userAgent = req.headers["user-agent"] ?? null;

        const result = validateMultisigImportPayload(req.body);
        if (!result.ok) {
            return res.status(result.status).json(result.body);
        }
        const { summary, rows } = result;

        console.log("[api/v1/ejection/redirect] Received multisig import POST:", {
            receivedAt,
            origin,
            userAgent,
            query: req.query,
            multisigId: summary.multisigId,
            multisigName: summary.multisigName,
            multisigAddress: summary.multisigAddress,
            network: summary.network,
            signerCount: summary.signerStakeKeys.length,
            signerStakeKeys: summary.signerStakeKeys,
            signerAddresses: summary.signerAddresses,
            rows: rows,
        });


        // Use aligned signersDescriptions from validator (already tag-stripped and ordered)
        const signersDescriptions = Array.isArray(summary.signersDescriptions) ? summary.signersDescriptions : [];

        // Backfill missing signer payment addresses via stake address lookup
        const stakeAddresses = Array.isArray(summary.stakeAddressesUsed) ? summary.stakeAddressesUsed : [];
        const signerAddresses = Array.isArray(summary.signerAddresses) ? summary.signerAddresses : [];
        type BlockchainProvider = {
            get: (path: string) => Promise<unknown>;
            fetchAccountInfo?: (stakeAddr: string) => Promise<unknown>;
        };
        function isRecord(v: unknown): v is Record<string, unknown> {
            return typeof v === "object" && v !== null;
        }
        function normalizeArrayResponse(resp: unknown): unknown[] {
            if (Array.isArray(resp)) return resp;
            if (isRecord(resp) && Array.isArray(resp.data)) return resp.data as unknown[];
            return [];
        }
        function extractFirstAddress(arr: unknown[]): string | null {
            if (!Array.isArray(arr) || arr.length === 0) return null;
            const first = arr[0];
            if (typeof first === "string") return first;
            if (isRecord(first)) {
                const maybe = (first as { address?: unknown }).address;
                if (typeof maybe === "string") return maybe;
            }
            return null;
        }
        async function fetchFirstPaymentAddressForStake(stakeAddr: string): Promise<string | null> {
            try {
                const network = addressToNetwork(stakeAddr);
                const blockchainProvider = getProvider(network) as unknown as BlockchainProvider;
                const endpoint = `/accounts/${stakeAddr}/addresses?count=1&order=asc`;
                const resp = await blockchainProvider.get(endpoint).catch(() => null);
                const arr = normalizeArrayResponse(resp);
                const addr = extractFirstAddress(arr);
                if (addr) {
                    return addr;
                }
            } catch (e) {
                console.error("[api/v1/ejection/redirect] fetchFirstPaymentAddressForStake error", e);
            }
            return null;
        }

        const paymentAddressesUsed = await Promise.all(
            (signerAddresses || []).map(async (addr, idx) => {
                const trimmed = typeof addr === "string" ? addr.trim() : "";
                if (trimmed) return trimmed;
                const stakeAddr = stakeAddresses[idx];
                if (!stakeAddr) return "";
                const found = await fetchFirstPaymentAddressForStake(stakeAddr);
                return found ?? "";
            })
        );

        // Persist to NewWallet using validated data
        let dbUpdated = false;
        let newWalletId: string | null = null;
        try {
            // ownerAddress must strictly be the multisigAddress
            const ownerAddress = summary.multisigAddress ?? "";
            if (!ownerAddress) {
                return res.status(400).json({ error: "multisigAddress is required as ownerAddress" });
            }

            // Find existing wallet by ownerAddress to avoid duplicates
            const existing = await db.newWallet.findFirst({ where: { ownerAddress } });
            if (existing) {
                const updated = await db.newWallet.update({
                    where: { id: existing.id },
                    data: {
                        name: summary.multisigName ?? existing.name ?? "Imported Multisig",
                        description: "Imported via ejection redirect",
                        signersAddresses: paymentAddressesUsed,
                        signersStakeKeys: summary.signerStakeKeys,
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                        ownerAddress,
                    },
                });
                console.log("[api/v1/ejection/redirect] NewWallet update success:", { id: updated.id });
                dbUpdated = true;
                newWalletId = updated.id;
            } else {
                const created = await db.newWallet.create({
                    data: {
                        // Let Prisma generate id (cuid()) when multisigId is not present
                        ...(summary.multisigId ? { id: summary.multisigId } : {}),
                        name: summary.multisigName ?? "Imported Multisig",
                        description: "Imported via ejection redirect",
                        signersAddresses: paymentAddressesUsed,
                        signersStakeKeys: summary.signerStakeKeys,
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                        ownerAddress,
                    },
                });
                console.log("[api/v1/ejection/redirect] NewWallet create success:", { id: created.id });
                dbUpdated = true;
                newWalletId = created.id;
            }
        } catch (err) {
            console.error("[api/v1/ejection/redirect] NewWallet upsert failed:", err);
        }

        return res.status(200).json({
            ok: true,
            receivedAt,
            multisigId: summary.multisigId,
            multisigName: summary.multisigName,
            multisigAddress: summary.multisigAddress,
            network: summary.network,
            signerCount: summary.signerStakeKeys.length,
            numRequiredSigners: summary.numRequiredSigners,
            stakeKeysUsed: summary.stakeAddressesUsed,
            paymentKeysUsed: paymentAddressesUsed,
            stakeKeyHexes: summary.signerStakeKeys,
            dbUpdated,
            newWalletId,
        });
    } catch (error) {
        console.error("[api/v1/ejection/redirect] Error handling POST:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}


