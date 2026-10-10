import type { AddressLabeler } from "@/types/token-flow";
import type { DraftSource } from "@/types/tx-draft";

/** Runtime facts needed to turn a source into a concrete address. */
export type SourceResolution = {
  multisigAddress: string;
  /** The connected signer wallet's payment address, when a wallet is connected. */
  connectedAddress?: string;
};

/** The source's payment address, or "" while it isn't known yet. */
export function resolveSourceAddress(
  source: DraftSource,
  ctx: SourceResolution,
): string {
  switch (source.kind) {
    case "multisig":
      return ctx.multisigAddress;
    case "connected":
      return ctx.connectedAddress ?? "";
    case "address":
      return source.address.trim();
  }
}

/** Human label for banners and toggles. */
export function describeSource(
  source: DraftSource,
  opts: { walletName?: string } = {},
): string {
  switch (source.kind) {
    case "multisig":
      return "Multisig wallet";
    case "connected":
      return opts.walletName
        ? `Connected wallet (${opts.walletName})`
        : "Connected wallet";
    case "address":
      return "Other address";
  }
}

/**
 * What the builder's primary action is for a source: the multisig proposes,
 * the connected wallet signs and submits, an arbitrary address can only be
 * built and exported.
 */
export function sourcePrimaryAction(
  source: DraftSource,
): "propose" | "sign" | "none" {
  switch (source.kind) {
    case "multisig":
      return "propose";
    case "connected":
      return "sign";
    case "address":
      return "none";
  }
}

/**
 * Wraps an address labeler so a non-multisig source renders as the canvas's
 * "self" card (blue, Landmark icon) under a source-specific label, while
 * every other address — including the multisig's own — keeps its usual
 * label.
 */
export function withSourceLabel(
  base: AddressLabeler,
  source: DraftSource,
  sourceAddress: string,
  walletName?: string,
): AddressLabeler {
  if (source.kind === "multisig" || !sourceAddress) return base;
  const label =
    source.kind === "connected"
      ? describeSource(source, { walletName })
      : "Source address";
  return (address) =>
    address === sourceAddress ? { label, type: "self" } : base(address);
}
