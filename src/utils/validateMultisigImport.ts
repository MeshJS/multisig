import { checkValidAddress, addressToNetwork, stakeKeyHash } from "@/utils/multisigSDK";
import { serializeRewardAddress } from "@meshsdk/core";
import type { csl } from "@meshsdk/core-csl";
import { deserializeNativeScript } from "@meshsdk/core-csl";

export type ImportedMultisigRow = {
    multisig_id?: string;
    multisig_name?: string | null;
    multisig_address?: string;
    multisig_created_at?: string | null;
    multisig_updated_at?: string | null;
    payment_script?: string | null;
    stake_script?: string | null;
    user_id?: string;
    user_name?: string | null;
    user_address_bech32?: string;
    user_stake_pubkey_hash_hex?: string | null;
    user_ada_handle?: string | null;
    user_profile_photo_url?: string | null;
    user_created_at?: string | null;
    community_id?: string | null;
    community_name?: string | null;
    community_description?: string | null;
    community_profile_photo_url?: string | null;
    community_verified?: boolean | null;
    community_verified_name?: string | null;
    community_created_at?: string | null;
};

export type MultisigImportSummary = {
    multisigId?: string | null;
    multisigName: string | null;
    multisigAddress: string | null;
    numRequiredSigners?: number | null;
    paymentCbor: string;
    signerStakeKeys: string[];
    signerAddresses: string[];
    signersDescriptions: string[];
    signersDRepKeys: string[];
    network?: number;
    stakeAddressesUsed: string[];
    paymentAddressesUsed: string[];
    stakeCredentialHash?: string | null;
    scriptType?: string | null;
};

export type ValidationSuccess = { ok: true; rows: ImportedMultisigRow[]; summary: MultisigImportSummary };
export type ValidationFailure = { ok: false; status: number; body: Record<string, unknown> };
export type ValidationResult = ValidationSuccess | ValidationFailure;

const normalize = (v?: string | null) => (typeof v === "string" ? v.trim() : null);
const requiredField = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function validateMultisigImportPayload(payload: unknown): ValidationResult {
    const rowsUnknown = Array.isArray(payload)
        ? (payload as unknown[])
        : Array.isArray((payload as { rows?: unknown })?.rows)
            ? (((payload as { rows: unknown }).rows as unknown[]))
            : [];
    const rows = rowsUnknown as ImportedMultisigRow[];

    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            ok: false,
            status: 400,
            body: { error: "Expected an array of rows or { rows: [...] }" },
        };
    }

    const invalidIndexes: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        if (!requiredField(r.user_id) || !requiredField(r.user_stake_pubkey_hash_hex)) {
            invalidIndexes.push(i);
        }
    }
    if (invalidIndexes.length > 0) {
        return {
            ok: false,
            status: 400,
            body: {
                error: "Each row must include user_id and user_stake_pubkey_hash_hex",
                invalidIndexes,
            },
        };
    }

    // If provided, all multisig_id values must match
    const providedIds = rows
        .map((r) => r.multisig_id)
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    const multisigIds = new Set(providedIds);
    if (multisigIds.size > 1) {
        return {
            ok: false,
            status: 400,
            body: {
                error: "All rows must belong to the same multisig_id",
                multisigIds: Array.from(multisigIds),
            },
        };
    }

    const multisigId = rows[0]!.multisig_id ?? null;
    const multisigName = rows[0]!.multisig_name ?? null;
    const multisigAddress = rows[0]!.multisig_address ?? null;

    // Shared field consistency
    const base = {
        multisig_name: normalize(multisigName),
        multisig_address: normalize(multisigAddress),
        payment_script: normalize(rows[0]!.payment_script ?? null),
        stake_script: normalize(rows[0]!.stake_script ?? null),
    } as const;

    const fieldMismatches: Record<string, number[]> = {};
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        if (normalize(r.multisig_name) !== base.multisig_name) {
            (fieldMismatches.multisig_name ||= []).push(i);
        }
        if (normalize(r.multisig_address) !== base.multisig_address) {
            (fieldMismatches.multisig_address ||= []).push(i);
        }
        if (normalize(r.payment_script) !== base.payment_script) {
            (fieldMismatches.payment_script ||= []).push(i);
        }
        if (normalize(r.stake_script) !== base.stake_script) {
            (fieldMismatches.stake_script ||= []).push(i);
        }
    }
    if (Object.keys(fieldMismatches).length > 0) {
        return {
            ok: false,
            status: 400,
            body: {
                error: "All rows must share the same multisig_name, multisig_address, payment_script, and stake_script",
                fieldMismatches,
            },
        };
    }

    // Validate multisig address if present
    if (typeof multisigAddress === "string" && multisigAddress.trim().length > 0) {
        const isValid = checkValidAddress(multisigAddress);
        if (!isValid) {
            return { ok: false, status: 400, body: { error: "Invalid multisig_address format" } };
        }
    }

    // Validate any provided user addresses
    const invalidUserAddressIndexes: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        const addr = rows[i]!.user_address_bech32;
        if (typeof addr === "string" && addr.trim().length > 0) {
            const valid = checkValidAddress(addr);
            if (!valid) {
                invalidUserAddressIndexes.push(i);
            }
        }
    }
    if (invalidUserAddressIndexes.length > 0) {
        return {
            ok: false,
            status: 400,
            body: {
                error: "One or more user_address_bech32 values are invalid",
                invalidUserAddressIndexes,
            },
        };
    }

    // Build aligned arrays for signer stake keys, addresses, descriptions, and drep keys; ensure deterministic ordering
    type CombinedSigner = { stake: string; address: string; description: string; drepKey: string };
    const combined: CombinedSigner[] = [];
    const seenStake = new Set<string>();
    const stripTags = (v: string) => v.replace(/<[^>]*>/g, "").trim();
    for (const r of rows) {
        const raw = r.user_stake_pubkey_hash_hex!;
        const hex = typeof raw === "string" ? raw.trim().toLowerCase() : "";
        if (!hex || seenStake.has(hex)) continue;
        seenStake.add(hex);
        const addr = typeof r.user_address_bech32 === "string" ? r.user_address_bech32.trim() : "";
        const desc = typeof r.community_description === "string" ? stripTags(r.community_description) : "";
        const drepKey = ""; // Empty for now as requested
        combined.push({ stake: hex, address: addr, description: desc, drepKey });
    }
    const signerStakeKeys = combined.map((c) => c.stake);
    const signerAddresses = combined.map((c) => c.address);
    const signersDescriptions = combined.map((c) => c.description);
    const signersDRepKeys = combined.map((c) => c.drepKey);

    // Infer network: prefer multisigAddress; if absent, fall back to the first valid user_address_bech32
    let network: 0 | 1 | undefined = undefined;
    if (typeof multisigAddress === "string" && multisigAddress.trim().length > 0) {
        network = addressToNetwork(multisigAddress) as 0 | 1;
    }
    if (network === undefined) {
        for (const r of rows) {
            const maybeAddr = r.user_address_bech32;
            if (typeof maybeAddr === "string" && maybeAddr.trim().length > 0 && checkValidAddress(maybeAddr)) {
                network = addressToNetwork(maybeAddr) as 0 | 1;
                break;
            }
        }
    }

    // Validate stake key hashes by reconstructing reward address and resolving back
    const invalidStakeKeyIndexes: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        const raw = rows[i]!.user_stake_pubkey_hash_hex!;
        const hex = typeof raw === "string" ? raw.trim().toLowerCase() : "";
        // Expect 28-byte (56 hex chars) hash
        if (!/^[0-9a-f]{56}$/.test(hex)) {
            invalidStakeKeyIndexes.push(i);
            continue;
        }
        const networksToTry: Array<0 | 1> = network === undefined ? [0, 1] : [network];
        let validForAny = false;
        for (const netId of networksToTry) {
            try {
                const stakeAddr = serializeRewardAddress(hex, false, netId);
                const resolved = stakeKeyHash(stakeAddr)?.toLowerCase();
                if (resolved === hex) {
                    validForAny = true;
                    break;
                }
            } catch {
                // ignore and try next
            }
        }
        if (!validForAny) {
            invalidStakeKeyIndexes.push(i);
        }
    }
    if (invalidStakeKeyIndexes.length > 0) {
        const invalidStakeKeyDetails = invalidStakeKeyIndexes.map((idx) => ({
            index: idx,
            user_id: rows[idx]!.user_id ?? null,
            user_stake_pubkey_hash_hex: rows[idx]!.user_stake_pubkey_hash_hex ?? null,
        }));
        return {
            ok: false,
            status: 400,
            body: {
                error: "One or more user_stake_pubkey_hash_hex values are invalid",
                invalidStakeKeyIndexes,
                invalidStakeKeyDetails,
            },
        };
    }

    // If a payment_script CBOR is provided, attempt to decode it to extract the required signers count
    let requiredFromPaymentScript: number | undefined = undefined;
    const providedPaymentCbor = typeof rows[0]!.payment_script === "string" ? rows[0]!.payment_script.trim() : null;
    if (providedPaymentCbor) {
        try {
            const decoded = decodeNativeScriptFromCbor(providedPaymentCbor);
            // Log the decoded native script structure for visibility/debugging
            // eslint-disable-next-line no-console
            console.log("Imported payment native script (decoded):", JSON.stringify(decoded, null, 2));
            requiredFromPaymentScript = computeRequiredSigners(decoded);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to decode provided payment_script CBOR:", e);
        }
    }

    const stakeAddressesUsed = buildStakeAddressesFromHashes(signerStakeKeys, network);

    return {
        ok: true,
        rows,
        summary: {
            multisigId,
            multisigName,
            multisigAddress,
            numRequiredSigners: requiredFromPaymentScript ?? null,
            paymentCbor: providedPaymentCbor ?? "",
            signerStakeKeys,
            signerAddresses,
            signersDescriptions,
            signersDRepKeys,
            network,
            stakeAddressesUsed,
            paymentAddressesUsed: signerAddresses,
            stakeCredentialHash: null, // Empty for now as requested
            scriptType: null, // Empty for now as requested
        },
    };
}

function buildStakeAddressesFromHashes(stakeKeys: string[], network: number | undefined): string[] {
    const out: string[] = [];
    for (const hex of stakeKeys) {
        const tryNetworks: Array<0 | 1> = network === undefined ? [0, 1] : [network as 0 | 1];
        let chosen: string | undefined;
        for (const netId of tryNetworks) {
            try {
                const addr = serializeRewardAddress(hex, false, netId);
                const resolved = stakeKeyHash(addr)?.toLowerCase();
                if (resolved === hex) {
                    chosen = addr;
                    break;
                }
            } catch {
                // continue to next network option
            }
        }
        if (chosen) out.push(chosen);
    }
    return Array.from(new Set(out));
}

// --- Native script decoding helpers ---

type DecodedNativeScript =
    | { type: "sig"; keyHash: string }
    | { type: "all"; scripts: DecodedNativeScript[] }
    | { type: "any"; scripts: DecodedNativeScript[] }
    | { type: "atLeast"; required: number; scripts: DecodedNativeScript[] };

function decodeNativeScriptFromCbor(cborHex: string): DecodedNativeScript {
    const ns = deserializeNativeScript(cborHex);
    return decodeNativeScriptFromCsl(ns);
}

function decodeNativeScriptFromCsl(ns: csl.NativeScript): DecodedNativeScript {
    const sp = ns.as_script_pubkey();
    if (sp) {
        const keyHash = sp.addr_keyhash().to_hex();
        return { type: "sig", keyHash };
    }

    const saAll = ns.as_script_all();
    if (saAll) {
        const list = saAll.native_scripts();
        const scripts: DecodedNativeScript[] = [];
        for (let i = 0; i < list.len(); i++) {
            const child = list.get(i);
            scripts.push(decodeNativeScriptFromCsl(child));
        }
        return { type: "all", scripts };
    }

    const saAny = ns.as_script_any();
    if (saAny) {
        const list = saAny.native_scripts();
        const scripts: DecodedNativeScript[] = [];
        for (let i = 0; i < list.len(); i++) {
            const child = list.get(i);
            scripts.push(decodeNativeScriptFromCsl(child));
        }
        return { type: "any", scripts };
    }

    const sn = ns.as_script_n_of_k();
    if (sn) {
        const list = sn.native_scripts();
        const scripts: DecodedNativeScript[] = [];
        for (let i = 0; i < list.len(); i++) {
            const child = list.get(i);
            scripts.push(decodeNativeScriptFromCsl(child));
        }
        const n = sn.n();
        const required = typeof n === "number" ? n : Number((n as unknown as { to_str?: () => string }).to_str?.() ?? n as unknown as number);
        return { type: "atLeast", required, scripts };
    }

    // Unknown variant; default to requiring 1 signature
    return { type: "atLeast", required: 1, scripts: [] };
}

function computeRequiredSigners(script: DecodedNativeScript): number {
    switch (script.type) {
        case "sig":
            return 1;
        case "any":
            return script.scripts.length > 0 ? 1 : 0;
        case "all": {
            let total = 0;
            for (const s of script.scripts) total += computeRequiredSigners(s);
            return total;
        }
        case "atLeast":
            return Math.max(0, script.required);
        default:
            return 0;
    }
}


