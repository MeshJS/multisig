import type { CIWalletType } from "./types";

/** Normalize wallet type from env/CLI strings (legacy default). */
export function normalizeWalletTypeFromLabel(value: string): CIWalletType {
  const v = value.trim().toLowerCase();
  if (v === "hierarchical" || v === "sdk") return v;
  return "legacy";
}
