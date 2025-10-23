import { checkValidAddress, addressToNetwork, stakeKeyHash, paymentKeyHash } from "@/utils/multisigSDK";
import { serializeRewardAddress, pubKeyAddress } from "@meshsdk/core";
import type { csl } from "@meshsdk/core-csl";
import { deserializeNativeScript } from "@meshsdk/core-csl";
import { getProvider } from "@/utils/get-provider";

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

export async function validateMultisigImportPayload(payload: unknown): Promise<ValidationResult> {
    // Accept only new shape: { community, multisig, users }
    const p = (payload as Record<string, unknown>) ?? {};
    const community = (p as any)?.community ?? {};
    const multisig = (p as any)?.multisig ?? {};
    const users = Array.isArray((p as any)?.users) ? ((p as any).users as any[]) : [];

    let rows: ImportedMultisigRow[] = [];
    if (users.length > 0 && (multisig?.id || multisig?.address || multisig?.payment_script || multisig?.stake_script)) {
        rows = users.map((u: any) => {
            const stakeHex = typeof u?.stake_pubkey_hash_hex === "string" ? u.stake_pubkey_hash_hex.trim().toLowerCase() : null;
            const out: ImportedMultisigRow = {
                multisig_id: typeof multisig?.id === "string" ? multisig.id : undefined,
                multisig_name: typeof multisig?.name === "string" ? multisig.name : null,
                multisig_address: typeof multisig?.address === "string" ? multisig.address : undefined,
                multisig_created_at: typeof multisig?.created_at === "string" ? multisig.created_at : null,
                payment_script: typeof multisig?.payment_script === "string" ? multisig.payment_script : null,
                stake_script: typeof multisig?.stake_script === "string" ? multisig.stake_script : null,
                user_id: typeof u?.id === "string" ? u.id : undefined,
                user_name: typeof u?.name === "string" ? u.name : "",
                user_address_bech32: typeof u?.address_bech32 === "string" ? u.address_bech32 : "",
                user_stake_pubkey_hash_hex: stakeHex,
                user_ada_handle: typeof u?.ada_handle === "string" ? u.ada_handle : "",
                user_profile_photo_url: typeof u?.profile_photo_url === "string" ? u.profile_photo_url : null,
                community_id: typeof community?.id === "string" ? community.id : null,
                community_name: typeof community?.name === "string" ? community.name : null,
                community_description: typeof community?.description === "string" ? community.description : null,
                community_profile_photo_url: typeof community?.profile_photo_url === "string" ? community.profile_photo_url : null,
                community_verified: typeof community?.verified === "boolean" ? community.verified : null,
                community_verified_name: typeof community?.verified_name === "string" ? community.verified_name : null,
                community_created_at: null,
            };
            return out;
        });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
        // Fallback: when users array is empty, derive users from stakeCbor if it differs from paymentCbor
        try {
            const paymentCborRaw = typeof (multisig as any)?.payment_script === "string"
                ? ((multisig as any).payment_script as string).trim()
                : null;
            const stakeCborRaw = typeof (multisig as any)?.stake_script === "string"
                ? ((multisig as any).stake_script as string).trim()
                : null;
            const paymentCborNorm = paymentCborRaw ? normalizeCborHex(paymentCborRaw) : "";
            const stakeCborNorm = stakeCborRaw ? normalizeCborHex(stakeCborRaw) : "";
            const differs = paymentCborNorm && stakeCborNorm && paymentCborNorm !== stakeCborNorm;

            if (differs && stakeCborRaw) {
                const decodedStakeForUsers = decodeNativeScriptFromCbor(stakeCborRaw);
                const stakeHashesForUsers = collectSigKeyHashes(decodedStakeForUsers);
                if (Array.isArray(stakeHashesForUsers) && stakeHashesForUsers.length > 0) {
                    rows = stakeHashesForUsers.map((hex) => {
                        const stakeHex = (hex || "").toLowerCase();
                        const out: ImportedMultisigRow = {
                            multisig_id: typeof (multisig as any)?.id === "string" ? (multisig as any).id : undefined,
                            multisig_name: typeof (multisig as any)?.name === "string" ? (multisig as any).name : null,
                            multisig_address: typeof (multisig as any)?.address === "string" ? (multisig as any).address : undefined,
                            multisig_created_at: typeof (multisig as any)?.created_at === "string" ? (multisig as any).created_at : null,
                            payment_script: typeof (multisig as any)?.payment_script === "string" ? (multisig as any).payment_script : null,
                            stake_script: typeof (multisig as any)?.stake_script === "string" ? (multisig as any).stake_script : null,
                            user_id: stakeHex, // Use stake hash as a deterministic id
                            user_name: "",
                            user_address_bech32: "",
                            user_stake_pubkey_hash_hex: stakeHex,
                            user_ada_handle: "",
                            user_profile_photo_url: null,
                            community_id: typeof (community as any)?.id === "string" ? (community as any).id : null,
                            community_name: typeof (community as any)?.name === "string" ? (community as any).name : null,
                            community_description: typeof (community as any)?.description === "string" ? (community as any).description : null,
                            community_profile_photo_url: typeof (community as any)?.profile_photo_url === "string" ? (community as any).profile_photo_url : null,
                            community_verified: typeof (community as any)?.verified === "boolean" ? (community as any).verified : null,
                            community_verified_name: typeof (community as any)?.verified_name === "string" ? (community as any).verified_name : null,
                            community_created_at: null,
                        };
                        return out;
                    });
                }
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to derive users from stakeCbor fallback:", e);
        }
    }

    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            ok: false,
            status: 400,
            body: { error: "Expected payload: { community, multisig, users }" },
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
                error: "Each user must include id and stake_pubkey_hash_hex",
                invalidIndexes,
            },
        };
    }

    // Read multisig fields from top-level payload
    const multisigId = typeof (payload as any)?.multisig?.id === "string" ? (payload as any).multisig.id : null;
    const multisigName = typeof (payload as any)?.multisig?.name === "string" ? (payload as any).multisig.name : null;
    const multisigAddress = typeof (payload as any)?.multisig?.address === "string" ? (payload as any).multisig.address : null;

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

    // Build aligned arrays for signer stake keys, addresses, user names, and drep keys; ensure deterministic ordering
    type CombinedSigner = { stake: string; address: string; name: string; drepKey: string };
    const combined: CombinedSigner[] = [];
    const seenStake = new Set<string>();
    const sanitizeText = (v: string) => {
        const noTags = v.replace(/<[^>]*>/g, "");
        return noTags
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/`/g, "&#96;")
            .trim();
    };
    for (const r of rows) {
        const raw = r.user_stake_pubkey_hash_hex!;
        const hex = typeof raw === "string" ? raw.trim().toLowerCase() : "";
        if (!hex || seenStake.has(hex)) continue;
        seenStake.add(hex);
        const addr = typeof r.user_address_bech32 === "string" ? r.user_address_bech32.trim() : "";
        // Use user_name for descriptions as requested, sanitized for safety
        const nameRaw = typeof r.user_name === "string" ? r.user_name.trim() : "";
        const name = nameRaw ? sanitizeText(nameRaw) : "";
        const drepKey = ""; // Empty for now as requested
        combined.push({ stake: hex, address: addr, name, drepKey });
    }
    const signerStakeKeys = combined.map((c) => c.stake);
    const signerAddresses = combined.map((c) => c.address);
    const signerNames = combined.map((c) => c.name);
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
    const providedPaymentCbor = typeof (payload as any)?.multisig?.payment_script === "string"
        ? ((payload as any).multisig.payment_script as string).trim()
        : null;
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
            // Build stake addresses early so we can expand candidate payment addresses via stake keys
            const stakeAddressesUsedForExpansion = buildStakeAddressesFromHashes(signerStakeKeys, network);
            // Try to match using provided payment addresses and any addresses fetched from stake accounts
            paymentSigMatches = await matchPaymentSigsExpanded(
                paymentSigKeyHashes,
                signerAddresses,
                stakeAddressesUsedForExpansion,
                network,
            );
            // eslint-disable-next-line no-console
            console.log("Payment sig match results:", JSON.stringify(paymentSigMatches, null, 2));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to decode provided payment_script CBOR:", e);
        }
    }

    // If a stake_script CBOR is provided, attempt to decode it and log for visibility
    const providedStakeCbor = typeof (payload as any)?.multisig?.stake_script === "string"
        ? ((payload as any).multisig.stake_script as string).trim()
        : null;
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
    let signersDescriptionsOrdered: string[] = signerNames; // will realign to addresses order
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
        // Build descriptions in the same order as signerAddressesOrdered
        signersDescriptionsOrdered = paymentSigKeyHashes.map((sig) => {
            const m = lowerMatches.get(sig.toLowerCase());
            if (m?.matched && typeof m.signerIndex === "number") {
                const idx = m.signerIndex;
                return typeof signerNames[idx] === "string" ? signerNames[idx] : "";
            }
            return ""; // unknown when no address match
        });
    }

    // Decide whether to order stake keys by stake script key hash order:
    // - If no payment addresses matched the payment script key hashes, OR
    // - If the stake script differs from the payment script.
    const paymentCborNorm = providedPaymentCbor ? normalizeCborHex(providedPaymentCbor) : "";
    const stakeCborNorm = providedStakeCbor ? normalizeCborHex(providedStakeCbor) : "";
    const stakeScriptDiffers = paymentCborNorm !== stakeCborNorm;
    const anyPaymentMatch = Array.isArray(paymentSigMatches) && paymentSigMatches.some((m) => m.matched);
    const noPaymentMatches = paymentSigKeyHashes.length > 0 ? !anyPaymentMatch : false;

    let signerStakeKeysOrdered: string[] = signerStakeKeys;
    let stakeAddressesUsedFinal: string[] = stakeAddressesUsed;
    // If payment and stake scripts are identical, align stake keys order to signer addresses order
    if (!stakeScriptDiffers && paymentSigKeyHashes.length > 0) {
        const lowerMatches = new Map<string, SigMatch>();
        for (const m of paymentSigMatches) {
            lowerMatches.set(m.sigKeyHash.toLowerCase(), m);
        }
        signerStakeKeysOrdered = paymentSigKeyHashes.map((sig, i) => {
            const m = lowerMatches.get(sig.toLowerCase());
            if (m?.matched && typeof m.signerIndex === "number") {
                const idx = m.signerIndex;
                const hex = (signerStakeKeys[idx] || "").toLowerCase();
                return hex && /^[0-9a-f]{56}$/.test(hex) ? hex : (stakeSigKeyHashes[i] || "").toLowerCase();
            }
            // Fallback to stake script's key hash at same position, or empty string
            return (stakeSigKeyHashes[i] || "").toLowerCase();
        });
        // Recompute stakeAddressesUsed to stay positionally aligned with the reordered stake keys
        stakeAddressesUsedFinal = signerStakeKeysOrdered.map((hex) => {
            const h = (hex || "").toLowerCase();
            const tryNetworks: Array<0 | 1> = network === undefined ? [0, 1] : [network as 0 | 1];
            for (const netId of tryNetworks) {
                try {
                    const addr = serializeRewardAddress(h, false, netId);
                    const resolved = stakeKeyHash(addr)?.toLowerCase();
                    if (resolved === h) return addr;
                } catch {
                    // try next
                }
            }
            return h;
        });
    } else if ((noPaymentMatches || stakeScriptDiffers) && stakeSigKeyHashes.length > 0) {
        const lowerMatches = new Map<string, SigMatch>();
        for (const m of stakeSigMatches) {
            lowerMatches.set(m.sigKeyHash.toLowerCase(), m);
        }
        signerStakeKeysOrdered = stakeSigKeyHashes.map((sig) => {
            const m = lowerMatches.get(sig.toLowerCase());
            const providedStakeHex = m?.signerStakeKey;
            if (m?.matched && typeof providedStakeHex === "string" && providedStakeHex.trim().length > 0) {
                return providedStakeHex.toLowerCase();
            }
            // Fallback: use the keyHash itself where no stake key was provided
            return sig.toLowerCase();
        });
        // Build stakeAddressesUsed positionally: reward addresses for matched keys, else raw key hash placeholders
        stakeAddressesUsedFinal = stakeSigKeyHashes.map((sig) => {
            const m = lowerMatches.get(sig.toLowerCase());
            const providedStakeHex = m?.signerStakeKey;
            if (m?.matched && typeof providedStakeHex === "string" && providedStakeHex.trim().length > 0) {
                // Try to compute a reward address for the matched stake key hash
                const hex = providedStakeHex.toLowerCase();
                const tryNetworks: Array<0 | 1> = network === undefined ? [0, 1] : [network as 0 | 1];
                for (const netId of tryNetworks) {
                    try {
                        const addr = serializeRewardAddress(hex, false, netId);
                        const resolved = stakeKeyHash(addr)?.toLowerCase();
                        if (resolved === hex) {
                            return addr;
                        }
                    } catch {
                        // continue to next
                    }
                }
                // If we couldn't build a valid reward address, fall back to the hex itself
                return hex;
            }
            // No match: use the script key hash in this position
            return sig.toLowerCase();
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
            signerStakeKeys: signerStakeKeysOrdered,
            signerAddresses: signerAddressesOrdered,
            signersDescriptions: signersDescriptionsOrdered,
            signersDRepKeys,
            network,
            stakeAddressesUsed: stakeAddressesUsedFinal,
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

async function fetchStakePaymentAddresses(stakeKey: string, network: number): Promise<string[]> {
    const blockchainProvider = getProvider(network);
    const res = await blockchainProvider.get(`/accounts/${stakeKey}/addresses`);
    // Normalize provider response to an array of bech32 strings
    const arr: unknown[] = Array.isArray(res) ? res : [];
    const out: string[] = [];
    for (const item of arr) {
        if (typeof item === "string") {
            out.push(item);
            continue;
        }
        if (item && typeof item === "object") {
            const maybe = (item as Record<string, unknown>).address
                ?? (item as Record<string, unknown>).bech32
                ?? (item as Record<string, unknown>).paymentAddress
                ?? (item as Record<string, unknown>).payment_address;
            if (typeof maybe === "string") out.push(maybe);
        }
    }
    const unique = Array.from(new Set(out.filter((s) => typeof s === "string" && s.trim().length > 0)));
    return unique;
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
                console.log("resolved", resolved, "hex", hex, "addr", addr);
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

// Expanded matcher: also fetch payment bech32s from stake accounts when
// - a signer has no provided payment address, or
// - a provided address's payment key hash is not among the required key hashes
async function matchPaymentSigsExpanded(
    sigKeyHashes: string[],
    signerAddresses: string[],
    stakeAddresses: string[],
    network: number | undefined,
): Promise<SigMatch[]> {
    const required = new Set(sigKeyHashes.map((s) => s.toLowerCase()));

    // Map payment key hash -> preferred candidate { index, address }
    const pkhToCandidate = new Map<string, { index: number; address: string }>();

    // First, consider provided signer addresses (no network calls)
    for (let i = 0; i < signerAddresses.length; i++) {
        const addr = signerAddresses[i];
        if (!addr || addr.trim().length === 0) continue;
        try {
            const pkh = paymentKeyHash(addr).toLowerCase();
            // Only store if it's one of the required hashes
            if (required.has(pkh) && !pkhToCandidate.has(pkh)) {
                pkhToCandidate.set(pkh, { index: i, address: addr });
            }
        } catch {
            // ignore invalid address
        }
    }
    

    // Determine which indices need expansion via stake account fetch
    const indicesNeedingExpansion: number[] = [];
    for (let i = 0; i < signerAddresses.length; i++) {
        const addr = signerAddresses[i];
        let needs = false;
        if (!addr || addr.trim().length === 0) {
            needs = true;
        } else {
            try {
                const pkh = paymentKeyHash(addr).toLowerCase();
                if (!required.has(pkh)) needs = true;
            } catch {
                needs = true;
            }
        }
        if (needs) indicesNeedingExpansion.push(i);
    }

    // If network unknown, skip fetching
    if (network !== 0 && network !== 1) {
        // Build matches from whatever candidates we already have
        const matches = sigKeyHashes.map((sig) => {
            const lower = sig.toLowerCase();
            const cand = pkhToCandidate.get(lower);
            if (cand) {
                return {
                    sigKeyHash: sig,
                    matched: true,
                    matchedBy: "paymentAddress",
                    signerIndex: cand.index,
                    signerAddress: cand.address,
                } as SigMatch;
            }
            return { sigKeyHash: sig, matched: false } as SigMatch;
        });
        
        return matches;
    }

    // Fetch additional addresses per stake account for the indices needing expansion
    const fetchPromises: Array<Promise<void>> = [];
    for (const i of indicesNeedingExpansion) {
        const stakeAddr = stakeAddresses[i];
        if (!stakeAddr || stakeAddr.trim().length === 0) continue;
        fetchPromises.push((async () => {
            try {
                const addrs = await fetchStakePaymentAddresses(stakeAddr, network);
                
                for (const a of addrs) {
                    try {
                        const pkh = paymentKeyHash(a).toLowerCase();
                        if (required.has(pkh) && !pkhToCandidate.has(pkh)) {
                            pkhToCandidate.set(pkh, { index: i, address: a });
                        }
                    } catch {
                        // ignore invalid address
                    }
                }
                
            } catch {
                // ignore fetch failure, continue
            }
        })());
    }

    await Promise.all(fetchPromises);

    // Build final matches, preserving order of sigKeyHashes
    const results = sigKeyHashes.map((sig) => {
        const lower = sig.toLowerCase();
        const cand = pkhToCandidate.get(lower);
        if (cand) {
            return {
                sigKeyHash: sig,
                matched: true,
                matchedBy: "paymentAddress",
                signerIndex: cand.index,
                signerAddress: cand.address,
            } as SigMatch;
        }
        return { sigKeyHash: sig, matched: false } as SigMatch;
    });
    
    return results;
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


