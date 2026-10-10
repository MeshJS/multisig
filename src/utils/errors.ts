/**
 * Map raw wallet / chain / network errors to a short, human-readable message.
 *
 * Errors in this app come from many layers (CIP-30 wallets, Blockfrost, the
 * UTXOS web wallet, Prisma/tRPC, Mesh) and are often surfaced verbatim in
 * toasts — including opaque codes like CIP-30 `{ code: -2 }`. This normalizes
 * the common cases and otherwise falls back to the raw message.
 */
function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (typeof obj.info === "string") return obj.info;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? "");
}

export function getFriendlyError(error: unknown): string {
  const raw = extractMessage(error);
  const m = raw.toLowerCase();

  // CIP-30 APIError / DataSignError shape: { code, info }
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const declined =
    m.includes("declin") ||
    m.includes("cancel") ||
    m.includes("reject") ||
    m.includes("refus") ||
    m.includes("user");
  if (code === -2 || code === -3 || code === 2 || code === 3) {
    return declined
      ? "You declined the request in your wallet."
      : "Your wallet couldn't complete the request. Please try again.";
  }

  if (m.includes("account changed"))
    return "Your wallet account changed. Please reconnect your wallet.";
  if (m.includes("too many requests") || m.includes("429"))
    return "The network is busy right now. Please try again in a moment.";
  if (m.includes("utxo balance insufficient") || m.includes("insufficient"))
    return "Insufficient funds in this wallet for the transaction.";
  if (m.includes("blockfrost"))
    return "Couldn't reach the Cardano network. Please try again.";
  if (m.includes("utxos") || m.includes("web3wallet"))
    return "Wallet service error. Please try again.";
  if (declined) return "Request cancelled in your wallet.";

  const trimmed = raw.trim();
  if (trimmed.length > 0 && trimmed.length < 200) return trimmed;
  return "Something went wrong. Please try again.";
}
