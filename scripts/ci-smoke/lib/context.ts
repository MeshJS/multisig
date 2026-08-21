/**
 * Read / write the versioned bootstrap context JSON used between CI stages.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { Context } from "../scenarios/types";

const ARTIFACTS_DIR = join(process.cwd(), "ci-artifacts");
const CONTEXT_FILE = join(ARTIFACTS_DIR, "bootstrap-context.json");

const CONTEXT_VERSION = "1";

export function writeContext(ctx: Context): void {
  mkdirSync(dirname(CONTEXT_FILE), { recursive: true });
  writeFileSync(CONTEXT_FILE, JSON.stringify({ ...ctx, version: CONTEXT_VERSION }, null, 2) + "\n");
}

export function readContext(): Context {
  const raw = readFileSync(CONTEXT_FILE, "utf8");
  const ctx = JSON.parse(raw) as Context;
  if (ctx.version !== CONTEXT_VERSION) {
    throw new Error(
      `Context version mismatch: expected ${CONTEXT_VERSION}, got ${ctx.version}`,
    );
  }
  return ctx;
}
