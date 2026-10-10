import type { CIWalletType } from "./types";

export function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

/** Parse comma-separated non-empty tokens (e.g. CI_ROUTE_SCENARIOS). */
export function parseCommaList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseWalletTypesEnv(raw: string): CIWalletType[] {
  const allowed = new Set(["legacy", "hierarchical", "sdk"]);
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length) {
    throw new Error("CI_WALLET_TYPES must include at least one wallet type");
  }
  const invalid = requested.filter((value) => !allowed.has(value));
  if (invalid.length) {
    throw new Error(
      `CI_WALLET_TYPES contains unsupported value(s): ${invalid.join(", ")}. Allowed: legacy,hierarchical,sdk`,
    );
  }
  return requested as CIWalletType[];
}
