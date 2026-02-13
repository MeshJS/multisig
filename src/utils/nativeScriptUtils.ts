import type { NativeScript } from "@meshsdk/core";
import type { csl } from "@meshsdk/core-csl";
import { deserializeNativeScript } from "@meshsdk/core-csl";

// --- Decoded native script types ---

export type DecodedNativeScript =
  | { type: "sig"; keyHash: string }
  | { type: "all"; scripts: DecodedNativeScript[] }
  | { type: "any"; scripts: DecodedNativeScript[] }
  | { type: "atLeast"; required: number; scripts: DecodedNativeScript[] }
  | { type: "timelockStart"; slot: string }
  | { type: "timelockExpiry"; slot: string };

export type SigMatch = {
  sigKeyHash: string;
  matched: boolean;
  matchedBy?: "paymentAddress" | "stakeKey";
  signerIndex?: number;
  signerAddress?: string;
  signerStakeKey?: string;
};

// --- CBOR normalization ---

export function normalizeCborHex(cborHex: string): string {
  const trimmed = (cborHex || "").trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

export function normalizeHex(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase().replace(/^0x/, "");
}

export function scriptHashFromCbor(cborHex?: string | null): string | undefined {
  if (!cborHex?.trim()) return undefined;
  try {
    const script = deserializeNativeScript(normalizeCborHex(cborHex));
    return normalizeHex(script.hash().to_hex());
  } catch {
    return undefined;
  }
}

// --- Decoding from CBOR / CSL ---

export function decodeNativeScriptFromCbor(
  cborHex: string,
): DecodedNativeScript {
  const ns = deserializeNativeScript(normalizeCborHex(cborHex));
  return decodeNativeScriptFromCsl(ns);
}

export function decodeNativeScriptFromCsl(
  ns: csl.NativeScript,
): DecodedNativeScript {
  const sp = ns.as_script_pubkey();
  if (sp) {
    const keyHash = sp.addr_keyhash().to_hex();
    return { type: "sig", keyHash };
  }

  const tls = ns.as_timelock_start?.();
  if (tls) {
    const slot = String(tls.slot_bignum?.().to_str?.() ?? tls.slot?.() ?? "0");
    return { type: "timelockStart", slot };
  }

  const tle = ns.as_timelock_expiry?.();
  if (tle) {
    const slot = String(tle.slot_bignum?.().to_str?.() ?? tle.slot?.() ?? "0");
    return { type: "timelockExpiry", slot };
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
    const required =
      typeof n === "number"
        ? n
        : Number(
            (n as unknown as { to_str?: () => string }).to_str?.() ??
              (n as unknown as number),
          );
    return { type: "atLeast", required, scripts };
  }

  // Unknown variant; default to requiring 1 signature
  return { type: "atLeast", required: 1, scripts: [] };
}

// --- Conversion: DecodedNativeScript -> @meshsdk/core NativeScript ---

export function decodedToNativeScript(
  decoded: DecodedNativeScript,
): NativeScript {
  switch (decoded.type) {
    case "sig":
      return { type: "sig", keyHash: decoded.keyHash };
    case "all":
      return {
        type: "all",
        scripts: decoded.scripts.map(decodedToNativeScript),
      };
    case "any":
      return {
        type: "any",
        scripts: decoded.scripts.map(decodedToNativeScript),
      };
    case "atLeast":
      return {
        type: "atLeast",
        required: decoded.required,
        scripts: decoded.scripts.map(decodedToNativeScript),
      };
    case "timelockStart":
      return { type: "after", slot: decoded.slot };
    case "timelockExpiry":
      return { type: "before", slot: decoded.slot };
    default:
      return { type: "all", scripts: [] };
  }
}

// --- Script analysis utilities ---

/** Collect all sig key hashes from a decoded native script tree (deduplicated). */
export function collectSigKeyHashes(node: DecodedNativeScript): string[] {
  if (node.type === "sig") return [node.keyHash.toLowerCase()];
  if (node.type === "all" || node.type === "any" || node.type === "atLeast") {
    const out: string[] = [];
    for (const child of node.scripts) out.push(...collectSigKeyHashes(child));
    return Array.from(new Set(out));
  }
  return [];
}

/**
 * A script is considered hierarchical ONLY if some signature node is nested
 * under two or more logical groups (all/any/atLeast).
 */
export function isHierarchicalScript(script: DecodedNativeScript): boolean {
  return hasSigWithLogicalDepth(script, 0);
}

function hasSigWithLogicalDepth(
  node: DecodedNativeScript,
  logicalDepth: number,
): boolean {
  if (node.type === "sig") {
    return logicalDepth >= 2;
  }
  if (node.type === "all" || node.type === "any" || node.type === "atLeast") {
    for (const child of node.scripts) {
      if (hasSigWithLogicalDepth(child, logicalDepth + 1)) return true;
    }
    return false;
  }
  return false;
}

/** Compute the minimum number of required signers to satisfy the script. */
export function computeRequiredSigners(script: DecodedNativeScript): number {
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
    case "atLeast": {
      if (script.scripts.length === 0)
        return Math.max(0, script.required);
      const childReqs = script.scripts
        .map((s) => computeRequiredSigners(s))
        .sort((a, b) => a - b);
      const need = Math.max(
        0,
        Math.min(script.required, childReqs.length),
      );
      let sum = 0;
      for (let i = 0; i < need; i++) sum += childReqs[i]!;
      return sum;
    }
    default:
      return 0;
  }
}

/**
 * Returns the signature rule type by inspecting parents of "sig" leaves:
 * - If any sig's parent is "atLeast", return "atLeast"
 * - Else if any sig's parent is "all", return "all"
 * - Else if any sig's parent is "any", return "any"
 * - Else fall back to the root type or "atLeast"
 */
export function detectTypeFromSigParents(
  script: DecodedNativeScript,
): "all" | "any" | "atLeast" {
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
  out: Set<"all" | "any" | "atLeast">,
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

/** Count total sig leaves in the tree (including duplicates). */
export function countTotalSigs(script: DecodedNativeScript): number {
  if (script.type === "sig") return 1;
  if (
    script.type === "all" ||
    script.type === "any" ||
    script.type === "atLeast"
  ) {
    let total = 0;
    for (const child of script.scripts) total += countTotalSigs(child);
    return total;
  }
  return 0;
}

/** Returns the max nesting depth of logical groups. */
export function getScriptDepth(script: DecodedNativeScript): number {
  if (
    script.type === "all" ||
    script.type === "any" ||
    script.type === "atLeast"
  ) {
    if (script.scripts.length === 0) return 1;
    let maxChild = 0;
    for (const child of script.scripts) {
      const d = getScriptDepth(child);
      if (d > maxChild) maxChild = d;
    }
    return 1 + maxChild;
  }
  return 0;
}
