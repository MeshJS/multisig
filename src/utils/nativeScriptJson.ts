/**
 * Provider (cardano-cli style) native-script JSON helpers.
 *
 * Kept free of runtime Mesh imports (only the NativeScript type) so API
 * routes can use them without pulling the SDK/WASM into their module
 * graph. Re-exported from cip146Discovery for the client-side callers.
 */

import type { NativeScript } from "@meshsdk/core";

/**
 * Convert provider (cardano-cli style) timelock JSON into a Mesh
 * NativeScript. Throws on malformed or non-timelock input.
 */
export function providerScriptJsonToNativeScript(json: unknown): NativeScript {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid native script JSON");
  }
  const node = json as Record<string, unknown>;
  const type = node.type;

  if (type === "sig") {
    if (typeof node.keyHash !== "string") {
      throw new Error("Invalid sig script: missing keyHash");
    }
    return { type: "sig", keyHash: node.keyHash };
  }
  if (type === "all" || type === "any") {
    if (!Array.isArray(node.scripts)) {
      throw new Error(`Invalid ${type} script: missing scripts`);
    }
    return {
      type,
      scripts: node.scripts.map(providerScriptJsonToNativeScript),
    };
  }
  if (type === "atLeast") {
    if (!Array.isArray(node.scripts) || typeof node.required !== "number") {
      throw new Error("Invalid atLeast script: missing scripts/required");
    }
    return {
      type: "atLeast",
      required: node.required,
      scripts: node.scripts.map(providerScriptJsonToNativeScript),
    };
  }
  if (type === "after" || type === "before") {
    if (node.slot === undefined || node.slot === null) {
      throw new Error(`Invalid ${type} script: missing slot`);
    }
    return { type, slot: String(node.slot) };
  }
  throw new Error(`Unsupported native script type: ${String(type)}`);
}

/** Collect sig key hashes in script order (lowercased, deduplicated). */
export function collectNativeScriptSigHashes(script: NativeScript): string[] {
  const out: string[] = [];
  const walk = (node: NativeScript) => {
    if (node.type === "sig") {
      const hash = node.keyHash.toLowerCase();
      if (!out.includes(hash)) out.push(hash);
      return;
    }
    if ("scripts" in node && Array.isArray(node.scripts)) {
      for (const child of node.scripts) walk(child);
    }
  };
  walk(script);
  return out;
}
