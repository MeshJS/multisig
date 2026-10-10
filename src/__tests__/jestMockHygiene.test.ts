import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Structural guard: `jest.mock(..., { virtual: true })` must not be used on a
 * module that actually exists.
 *
 * `virtual: true` is for modules with no file on disk. Applied to a real module
 * it registers the mock under the bare specifier rather than the resolved path,
 * so whether a given importer receives the mock or the real module depends on
 * resolution order — which varies with load and test-file count.
 *
 * That produced a genuine intermittent failure (~1 run in 8): when the
 * `@/server/api/root` mock in walletIds.bot.test.ts missed, the real tRPC root
 * loaded, which pulls in `superjson`. superjson v2 is ESM-only
 * (`"type": "module"`, a single ESM export, no CommonJS build) and the CJS jest
 * project has no transform matching `.js`, so loading it always throws
 * "Cannot use import statement outside a module". The mock miss was the
 * variable; the superjson failure was deterministic once it happened.
 *
 * This test is cheap insurance against the pattern being copy-pasted back in.
 */

const TEST_DIR = join(process.cwd(), "src", "__tests__");
const SRC_DIR = join(process.cwd(), "src");

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...testFiles(full));
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Mirrors the `^@/(.*)$` moduleNameMapper plus jest's extension resolution. */
function resolvesToRealFile(specifier: string): boolean {
  if (!specifier.startsWith("@/")) return false;
  const base = join(SRC_DIR, specifier.slice(2));
  return (
    [".ts", ".tsx", ".js"].some((ext) => existsSync(base + ext)) ||
    existsSync(join(base, "index.ts"))
  );
}

describe("jest.mock hygiene", () => {
  const files = testFiles(TEST_DIR);

  it("finds the test files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("never marks a real module as virtual", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("virtual: true")) continue;

      // Split on jest.mock( so each fragment is one call's arguments, letting a
      // `virtual: true` be attributed to the specifier it belongs to.
      for (const call of source.split(/jest\.mock\(/).slice(1)) {
        const specifier = call.match(/^\s*["']([^"']+)["']/)?.[1];
        if (!specifier) continue;
        if (!/\{\s*virtual:\s*true\s*\}/.test(call)) continue;
        if (resolvesToRealFile(specifier)) {
          offenders.push(`${file.replace(`${process.cwd()}/`, "")} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
