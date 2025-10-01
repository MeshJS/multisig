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

        const result = validateMultisigImportPayload(req.body);
        if (!result.ok) {
            return res.status(result.status).json(result.body);
        }
        const { summary, rows } = result;



        // Build wallet description from the first non-empty tagless community_description
        function stripTags(v: string) {
            return v.replace(/<[^>]*>/g, "").trim();
        }
        const walletDescription = (() => {
            for (const r of rows) {
                const desc = (r as { community_description?: unknown }).community_description;
                if (typeof desc === "string" && desc.trim().length > 0) {
                    return stripTags(desc);
                }
            }
            return "";
        })();

        // Set each signersDescriptions value to a fixed import message
        const signersDescriptions = new Array((summary.signerAddresses || []).length).fill(
            "Imported via ejection redirect",
        );

        // Backfill missing signer payment addresses via stake address lookup
        const stakeAddresses = Array.isArray(summary.stakeAddressesUsed) ? summary.stakeAddressesUsed : [];
        const signerAddresses = Array.isArray(summary.signerAddresses) ? summary.signerAddresses : [];
        type BlockchainProvider = {
            get: (path: string) => Promise<unknown>;
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
            const specifiedId = typeof summary.multisigId === "string" && summary.multisigId.trim().length > 0
                ? summary.multisigId.trim()
                : null;

            if (specifiedId) {
                const saved = await db.newWallet.upsert({
                    where: { id: specifiedId },
                    update: {
                        name: summary.multisigName ?? "Imported Multisig",
                        description: walletDescription,
                        signersAddresses: paymentAddressesUsed,
                        signersStakeKeys: summary.stakeAddressesUsed,
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                    },
                    create: {
                        id: specifiedId,
                        name: summary.multisigName ?? "Imported Multisig",
                        description: walletDescription,
                        signersAddresses: paymentAddressesUsed,
                        signersStakeKeys: summary.stakeAddressesUsed,
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                        ownerAddress: "",
                    },
                });
                console.log("[api/v1/ejection/redirect] NewWallet upsert success:", { id: saved.id });
                dbUpdated = true;
                newWalletId = saved.id;
            } else {
                const created = await db.newWallet.create({
                    data: {
                        name: summary.multisigName ?? "Imported Multisig",
                        description: walletDescription,
                        signersAddresses: paymentAddressesUsed,
                        signersStakeKeys: summary.stakeAddressesUsed,
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                        ownerAddress: "",
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
            dbUpdated,
            newWalletId,
        });
    } catch (error) {
        console.error("[api/v1/ejection/redirect] Error handling POST:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}


