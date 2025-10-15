import { checkValidAddress, addressToNetwork, stakeKeyHash, paymentKeyHash } from "@/utils/multisigSDK";
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
    stakeCbor: string;
    signerStakeKeys: string[];
    signerAddresses: string[];
    signersDescriptions: string[];
    signersDRepKeys: string[];
    network?: number;
    stakeAddressesUsed: string[];
    paymentAddressesUsed: string[];
    stakeCredentialHash?: string | null;
    scriptType?: string | null;
    usesStored: boolean;
    sigMatches?: {
        payment: SigMatch[];
        stake: SigMatch[];
    };
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

    // If a payment_script CBOR is provided, attempt to decode it to extract the required signers count and script type
    let requiredFromPaymentScript: number | undefined = undefined;
    let scriptTypeFromPaymentScript: "all" | "any" | "atLeast" | undefined = undefined;
    let isPaymentHierarchical = false;
    let paymentSigKeyHashes: string[] = [];
    let paymentSigMatches: SigMatch[] = [];
    const providedPaymentCbor = typeof rows[0]!.payment_script === "string" ? rows[0]!.payment_script.trim() : null;
    if (providedPaymentCbor) {
        try {
            const decoded = decodeNativeScriptFromCbor(providedPaymentCbor);
            // Log the decoded native script structure for visibility/debugging
            // eslint-disable-next-line no-console
            console.log("Imported payment native script (decoded):", JSON.stringify(decoded, null, 2));
            requiredFromPaymentScript = computeRequiredSigners(decoded);
            // Determine script type by inspecting parents of "sig" leaves.
            // Prefer the parent type of any signature node (atLeast > all > any). If none, fall back to root or "atLeast".
            scriptTypeFromPaymentScript = detectTypeFromSigParents(decoded);
            isPaymentHierarchical = isHierarchicalScript(decoded);
            paymentSigKeyHashes = collectSigKeyHashes(decoded);
            // eslint-disable-next-line no-console
            console.log("Payment script sig key hashes:", paymentSigKeyHashes);
            paymentSigMatches = matchPaymentSigs(paymentSigKeyHashes, signerAddresses);
            // eslint-disable-next-line no-console
            console.log("Payment sig match results:", JSON.stringify(paymentSigMatches, null, 2));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to decode provided payment_script CBOR:", e);
        }
    }

    // If a stake_script CBOR is provided, attempt to decode it and log for visibility
    const providedStakeCbor = typeof rows[0]!.stake_script === "string" ? rows[0]!.stake_script.trim() : null;
    let isStakeHierarchical = false;
    let stakeSigKeyHashes: string[] = [];
    let stakeSigMatches: SigMatch[] = [];
    if (providedStakeCbor) {
        try {
            const decodedStake = decodeNativeScriptFromCbor(providedStakeCbor);
            // eslint-disable-next-line no-console
            console.log("Imported stake native script (decoded):", JSON.stringify(decodedStake, null, 2));
            isStakeHierarchical = isHierarchicalScript(decodedStake);
            stakeSigKeyHashes = collectSigKeyHashes(decodedStake);
            // eslint-disable-next-line no-console
            console.log("Stake script sig key hashes:", stakeSigKeyHashes);
            stakeSigMatches = matchStakeSigs(stakeSigKeyHashes, signerStakeKeys);
            // eslint-disable-next-line no-console
            console.log("Stake sig match results:", JSON.stringify(stakeSigMatches, null, 2));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to decode provided stake_script CBOR:", e);
        }
    }

    const stakeAddressesUsed = buildStakeAddressesFromHashes(signerStakeKeys, network);

    // Reorder signer addresses to match payment script key hash order; fill gaps with key hashes
    let signerAddressesOrdered: string[] = signerAddresses;
    if (paymentSigKeyHashes.length > 0) {
        const lowerMatches = new Map<string, SigMatch>();
        for (const m of paymentSigMatches) {
            lowerMatches.set(m.sigKeyHash.toLowerCase(), m);
        }
        signerAddressesOrdered = paymentSigKeyHashes.map((sig) => {
            const m = lowerMatches.get(sig.toLowerCase());
            const addr = m?.signerAddress;
            if (m?.matched && typeof addr === "string" && addr.trim().length > 0) {
                return addr;
            }
            // Fallback: use the keyHash itself where no payment address was provided
            return sig;
        });
    }

    return {
        ok: true,
        rows,
        summary: {
            multisigId,
            multisigName,
            multisigAddress,
            numRequiredSigners: requiredFromPaymentScript ?? null,
            paymentCbor: providedPaymentCbor ?? "",
            stakeCbor: providedStakeCbor ?? "",
            signerStakeKeys,
            signerAddresses: signerAddressesOrdered,
            signersDescriptions,
            signersDRepKeys,
            network,
            stakeAddressesUsed,
            paymentAddressesUsed: signerAddressesOrdered,
            stakeCredentialHash: null, // Empty for now as requested
            scriptType: scriptTypeFromPaymentScript ?? null,
            usesStored: Boolean(isPaymentHierarchical || isStakeHierarchical),
            sigMatches: {
                payment: paymentSigMatches,
                stake: stakeSigMatches,
            },
        },
    };
}

// Returns the signature rule type for storage by inspecting parents of "sig" leaves:
// - If any signature's parent is "atLeast", return "atLeast"
// - Else if any signature's parent is "all", return "all"
// - Else if any signature's parent is "any", return "any"
// - Else fall back to the root type if it is "all" or "any"; otherwise return "atLeast" (1 of 1)
function detectTypeFromSigParents(script: DecodedNativeScript): "all" | "any" | "atLeast" {
    const parentTypes = new Set<"all" | "any" | "atLeast">();
    collectSigParentTypes(script, null, parentTypes);
    if (parentTypes.has("atLeast")) return "atLeast";
    if (parentTypes.has("all")) return "all";
    if (parentTypes.has("any")) return "any";
    if (script.type === "all" || script.type === "any") return script.type;
    return "atLeast";
}

function collectSigParentTypes(
    node: DecodedNativeScript,
    parentType: "all" | "any" | "atLeast" | null,
    out: Set<"all" | "any" | "atLeast">
): void {
    if (node.type === "sig") {
        if (parentType) out.add(parentType);
        return;
    }
    if (node.type === "all" || node.type === "any" || node.type === "atLeast") {
        for (const child of node.scripts) {
            collectSigParentTypes(child, node.type, out);
        }
        return;
    }
    // timelock nodes: nothing to traverse further
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
    | { type: "atLeast"; required: number; scripts: DecodedNativeScript[] }
    | { type: "timelockStart" }
    | { type: "timelockExpiry" };

type SigMatch = {
    sigKeyHash: string;
    matched: boolean;
    matchedBy?: "paymentAddress" | "stakeKey";
    signerIndex?: number;
    signerAddress?: string;
    signerStakeKey?: string;
};

function normalizeCborHex(cborHex: string): string {
    const trimmed = (cborHex || "").trim();
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
        return trimmed.slice(2);
    }
    return trimmed;
}

function decodeNativeScriptFromCbor(cborHex: string): DecodedNativeScript {
    const ns = deserializeNativeScript(normalizeCborHex(cborHex));
    return decodeNativeScriptFromCsl(ns);
}

function decodeNativeScriptFromCsl(ns: csl.NativeScript): DecodedNativeScript {
    const sp = ns.as_script_pubkey();
    if (sp) {
        const keyHash = sp.addr_keyhash().to_hex();
        return { type: "sig", keyHash };
    }

    const tls = ns.as_timelock_start?.();
    if (tls) {
        return { type: "timelockStart" };
    }

    const tle = ns.as_timelock_expiry?.();
    if (tle) {
        return { type: "timelockExpiry" };
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
        case "timelockStart":
        case "timelockExpiry":
            return 0;
        case "any":
            if (script.scripts.length === 0) return 0;
            return Math.min(...script.scripts.map((s) => computeRequiredSigners(s)));
        case "all": {
            let total = 0;
            for (const s of script.scripts) total += computeRequiredSigners(s);
            return total;
        }
        case "atLeast":
            if (script.scripts.length === 0) return Math.max(0, script.required);
            const childReqs = script.scripts.map((s) => computeRequiredSigners(s)).sort((a, b) => a - b);
            const need = Math.max(0, Math.min(script.required, childReqs.length));
            let sum = 0;
            for (let i = 0; i < need; i++) sum += childReqs[i]!;
            return sum;
        default:
            return 0;
    }
}

// A script is considered hierarchical ONLY if some signature node is nested under
// two or more logical groups (all/any/atLeast). Examples:
// - atLeast(sig, sig) -> NOT hierarchical (sig depth = 1)
// - all(any(sig, ...), ...) -> hierarchical (sig depth = 2)
// Timelock nodes are ignored and do not contribute to depth.
function isHierarchicalScript(script: DecodedNativeScript): boolean {
    return hasSigWithLogicalDepth(script, 0);
}

function hasSigWithLogicalDepth(node: DecodedNativeScript, logicalDepth: number): boolean {
    if (node.type === "sig") {
        // Require depth >= 2: root logical group -> child logical group -> sig
        return logicalDepth >= 2;
    }
    if (node.type === "all" || node.type === "any" || node.type === "atLeast") {
        for (const child of node.scripts) {
            if (hasSigWithLogicalDepth(child, logicalDepth + 1)) return true;
        }
        return false;
    }
    // Timelock nodes do not count towards logical depth and have no children to traverse
    return false;
}

// Collect all sig key hashes from a decoded native script tree
function collectSigKeyHashes(node: DecodedNativeScript): string[] {
    if (node.type === "sig") return [node.keyHash.toLowerCase()];
    if (node.type === "all" || node.type === "any" || node.type === "atLeast") {
        const out: string[] = [];
        for (const child of node.scripts) out.push(...collectSigKeyHashes(child));
        // De-duplicate in case of repeated leaves
        return Array.from(new Set(out));
    }
    return [];
}

// Match payment script sig key hashes to signer payment addresses
function matchPaymentSigs(sigKeyHashes: string[], signerAddresses: string[]): SigMatch[] {
    // Build mapping from payment key hash -> first signer index that yields it
    const pkhToIndex = new Map<string, number>();
    const indexToAddress = new Map<number, string>();
    for (let i = 0; i < signerAddresses.length; i++) {
        const addr = signerAddresses[i];
        if (typeof addr !== "string" || addr.trim().length === 0) continue;
        try {
            const pkh = paymentKeyHash(addr).toLowerCase();
            if (!pkhToIndex.has(pkh)) pkhToIndex.set(pkh, i);
            indexToAddress.set(i, addr);
        } catch {
            // ignore invalid address
        }
    }
    const matches: SigMatch[] = [];
    for (const sig of sigKeyHashes) {
        const idx = pkhToIndex.get(sig.toLowerCase());
        if (idx !== undefined) {
            matches.push({
                sigKeyHash: sig,
                matched: true,
                matchedBy: "paymentAddress",
                signerIndex: idx,
                signerAddress: indexToAddress.get(idx),
            });
        } else {
            matches.push({ sigKeyHash: sig, matched: false });
        }
    }
    return matches;
}

// Match stake script sig key hashes to signer stake key hashes
function matchStakeSigs(sigKeyHashes: string[], signerStakeKeys: string[]): SigMatch[] {
    const stakeSet = new Map<string, number>();
    for (let i = 0; i < signerStakeKeys.length; i++) {
        const hex = (signerStakeKeys[i] || "").toLowerCase();
        if (/^[0-9a-f]{56}$/.test(hex) && !stakeSet.has(hex)) stakeSet.set(hex, i);
    }
    const matches: SigMatch[] = [];
    for (const sig of sigKeyHashes) {
        const idx = stakeSet.get(sig.toLowerCase());
        if (idx !== undefined) {
            matches.push({
                sigKeyHash: sig,
                matched: true,
                matchedBy: "stakeKey",
                signerIndex: idx,
                signerStakeKey: signerStakeKeys[idx],
            });
        } else {
            matches.push({ sigKeyHash: sig, matched: false });
        }
    }
    return matches;
}


