import type { NextApiRequest, NextApiResponse } from "next";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { validateMultisigImportPayload } from "@/utils/validateMultisigImport";
import { db } from "@/server/db";


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

        // Set each signersDescriptions value to "Signer 1", "Signer 2", etc.
        const signersDescriptions = Array.from({ length: (summary.signerAddresses || []).length }, (_, index) => 
            `Signer ${index + 1}`
        );

        // Backfill missing signer payment addresses using stake keys instead of fetching
        const stakeAddresses = Array.isArray(summary.stakeAddressesUsed) ? summary.stakeAddressesUsed : [];
        const signerAddresses = Array.isArray(summary.signerAddresses) ? summary.signerAddresses : [];
        const paymentAddressesUsed = (signerAddresses || []).map((addr, idx) => {
            const trimmed = typeof addr === "string" ? addr.trim() : "";
            if (trimmed) return trimmed;
            const stakeAddr = stakeAddresses[idx];
            return typeof stakeAddr === "string" ? stakeAddr : "";
        });

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
                        signersDRepKeys: [],
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                        stakeCredentialHash: null,
                        scriptType: null,
                    },
                    create: {
                        id: specifiedId,
                        name: summary.multisigName ?? "Imported Multisig",
                        description: walletDescription,
                        signersAddresses: paymentAddressesUsed,
                        signersStakeKeys: summary.stakeAddressesUsed,
                        signersDRepKeys: [],
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                        ownerAddress: "",
                        stakeCredentialHash: null,
                        scriptType: null,
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
                        signersDRepKeys: [],
                        signersDescriptions,
                        numRequiredSigners: summary.numRequiredSigners,
                        ownerAddress: "",
                        stakeCredentialHash: null,
                        scriptType: null,
                    },
                });
                console.log("[api/v1/ejection/redirect] NewWallet create success:", { id: created.id });
                dbUpdated = true;
                newWalletId = created.id;
            }
        } catch (err) {
            console.error("[api/v1/ejection/redirect] NewWallet upsert failed:", err);
        }

        // Generate the URL for the multisig wallet invite page
        const baseUrl = "https://multisig.meshjs.dev";
        const inviteUrl = newWalletId ? `${baseUrl}/wallets/invite/${newWalletId}` : null;

        return res.status(200).json({
            ok: true,
            receivedAt,
            multisigAddress: summary.multisigAddress,
            dbUpdated,
            inviteUrl
        });
    } catch (error) {
        console.error("[api/v1/ejection/redirect] Error handling POST:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}


