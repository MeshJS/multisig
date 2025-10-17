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

        const result = await validateMultisigImportPayload(req.body);
        if (!result.ok) {
            return res.status(result.status).json(result.body);
        }
        const { summary, rows } = result;

		// Normalize request body into an array for consistent handling of signersDescriptions
		const bodyAsArray: unknown[] = req.body == null
			? []
			: Array.isArray(req.body)
				? (req.body as unknown[])
				: [req.body];
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

        // Use descriptions computed from validation (user_name aligned with signerAddresses)
        const signersDescriptions = Array.isArray(summary.signersDescriptions) ? summary.signersDescriptions : [];

        // Use signer payment addresses as provided; leave empty string if missing
        const paymentAddressesUsed = Array.isArray(summary.signerAddresses)
            ? summary.signerAddresses.map((addr: string) => (typeof addr === "string" ? addr.trim() : ""))
            : [];

        // Prepare raw import bodies to persist: prefer rows if provided, otherwise normalize req.body
        const rawImportBodies = Array.isArray((req.body as any)?.rows)
            ? (req.body as any).rows
            : Array.isArray(req.body)
                ? req.body
                : [req.body];

        // Persist to NewWallet using validated data
        let dbUpdated = false;
        let newWalletId: string | null = null;
        try {
            const specifiedId = typeof summary.multisigId === "string" && summary.multisigId.trim().length > 0
                ? summary.multisigId.trim()
                : null;

            if (specifiedId) {
                const updateData: any = {
                    name: summary.multisigName ?? "Imported Multisig",
                    description: walletDescription,
                    signersAddresses: paymentAddressesUsed,
                    signersStakeKeys: summary.stakeAddressesUsed,
                    signersDRepKeys: [],
                    signersDescriptions,
                    numRequiredSigners: summary.numRequiredSigners,
                    stakeCredentialHash: null,
                    scriptType: summary.scriptType ?? null,
                    paymentCbor: summary.paymentCbor ?? "",
                    stakeCbor: summary.stakeCbor ?? "",
                    usesStored: Boolean(summary.usesStored),
                    rawImportBodies,
                };
                const createDataWithId: any = {
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
                    scriptType: summary.scriptType ?? null,
                    paymentCbor: summary.paymentCbor ?? "",
                    stakeCbor: summary.stakeCbor ?? "",
                    usesStored: Boolean(summary.usesStored),
                    rawImportBodies,
                };
                const saved = await db.newWallet.upsert({
                    where: { id: specifiedId },
                    update: updateData,
                    create: createDataWithId,
                });
                console.log("[api/v1/ejection/redirect] NewWallet upsert success:", { id: saved.id });
                dbUpdated = true;
                newWalletId = saved.id;
            } else {
                const createData: any = {
                    name: summary.multisigName ?? "Imported Multisig",
                    description: walletDescription,
                    signersAddresses: paymentAddressesUsed,
                    signersStakeKeys: summary.stakeAddressesUsed,
                    signersDRepKeys: [],
                    signersDescriptions,
                    numRequiredSigners: summary.numRequiredSigners,
                    ownerAddress: "",
                    stakeCredentialHash: null,
                    scriptType: summary.scriptType ?? null,
                    paymentCbor: summary.paymentCbor ?? "",
                    stakeCbor: summary.stakeCbor ?? "",
                    usesStored: Boolean(summary.usesStored),
                    rawImportBodies,
                };
                const created = await db.newWallet.create({
                    data: createData,
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


