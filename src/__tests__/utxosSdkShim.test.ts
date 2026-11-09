import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * Browser builds alias `@utxos/sdk` to src/lib/utxos-sdk-lazy.ts, which only
 * provides `Web3Wallet.enable` (plus types). TypeScript still resolves the
 * real package, so a new value import — another class, a helper, an
 * `instanceof Web3Wallet` — would compile and then be undefined in the
 * browser. These checks make that a test failure instead.
 */

const ROOT = path.resolve(__dirname, "../..");
const SHIM_EXPORTS = new Set(["Web3Wallet"]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("@utxos/sdk browser shim", () => {
  it("is only value-imported for what the shim provides", () => {
    const offenders: string[] = [];
    const importRe =
      /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']@utxos\/sdk["']/g;
    for (const file of sourceFiles(path.join(ROOT, "src"))) {
      if (file.endsWith(path.join("lib", "utxos-sdk-lazy.ts"))) continue;
      const text = fs.readFileSync(file, "utf8");
      if (
        /import\s+\*\s+as\s+\w+\s+from\s+["']@utxos\/sdk["']/.test(text) ||
        /import\s+\w+\s+from\s+["']@utxos\/sdk["']/.test(text)
      ) {
        offenders.push(
          `${path.relative(ROOT, file)}: namespace/default import`,
        );
      }
      for (const match of text.matchAll(importRe)) {
        if (match[1]) continue; // `import type { … }` is erased
        for (const raw of match[2]!.split(",")) {
          const name = raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]!;
          if (!name || raw.trim().startsWith("type ")) continue;
          if (!SHIM_EXPORTS.has(name)) {
            offenders.push(`${path.relative(ROOT, file)}: ${name}`);
          }
        }
      }
      if (/instanceof\s+Web3Wallet\b/.test(text)) {
        offenders.push(`${path.relative(ROOT, file)}: instanceof Web3Wallet`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("covers everything @meshsdk/react uses from it", () => {
    const dist = fs.readFileSync(
      path.join(ROOT, "node_modules/@meshsdk/react/dist/index.js"),
      "utf8",
    );
    const imported = [
      ...dist.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@utxos\/sdk"/g),
    ]
      .flatMap((m) => m[1]!.split(","))
      .map((name) => name.trim())
      .filter(Boolean);
    expect(imported).toEqual(["Web3Wallet"]);
    // And only the static `enable` of it.
    const uses = [...dist.matchAll(/Web3Wallet\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(uses)).toEqual(new Set(["enable"]));
  });
});
