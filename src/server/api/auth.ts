/**
 * Shared auth helpers for tRPC routers.
 *
 * Consolidates `requireSessionAddress` and wallet-access checks that previously
 * lived as near-duplicates in every router file. Centralizing them ensures:
 * - one source of truth for the session-narrowing logic
 * - one place to extend (e.g. add audit emit on FORBIDDEN)
 * - future signer-table migrations only touch one helper
 */

import { TRPCError } from "@trpc/server";
import type { AuthCtx } from "@/server/api/trpc";

export const requireSessionAddress = (ctx: AuthCtx): string => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

/**
 * Resolves the set of wallet addresses authorized in the current session.
 * Prefers `sessionWallets` (multi-wallet auth) and falls back to the single
 * `sessionAddress`/`session.user.id`. Returns `[]` when no session.
 */
export const getSessionAddresses = (ctx: AuthCtx): string[] => {
  const sessionWallets = Array.isArray(ctx.sessionWallets) ? ctx.sessionWallets : [];
  if (sessionWallets.length > 0) {
    return sessionWallets;
  }
  const single = ctx.session?.user?.id ?? ctx.sessionAddress;
  return single ? [single] : [];
};

/**
 * Asserts that the caller can access the given wallet (signer or owner).
 * Looks up the wallet in the `wallet` table and validates membership via
 * `signersAddresses` or exact-match `ownerAddress`.
 *
 * Pass `requester` to override the session-derived address(es) — useful for
 * routers that accept an explicit `requesterAddress` input parameter.
 *
 * Throws NOT_FOUND if the wallet doesn't exist, FORBIDDEN if not authorized.
 */
export const assertWalletAccess = async (
  ctx: AuthCtx,
  walletId: string,
  requester?: string | string[],
) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }

  const requesters: string[] = requester
    ? Array.isArray(requester)
      ? requester
      : [requester]
    : [];
  const sessionAddresses = getSessionAddresses(ctx);
  const candidates = requesters.length > 0 ? [...requesters, ...sessionAddresses] : sessionAddresses;

  if (candidates.length === 0) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const authorized = candidates.some((addr) => {
    const isSigner =
      Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(addr);
    const isOwner = wallet.ownerAddress === addr;
    return isSigner || isOwner;
  });

  if (!authorized) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
  }

  return wallet;
};

/**
 * Stricter variant: only the wallet owner (exact-match `ownerAddress`) passes.
 * Used for ownership transfers, deletions, and other privileged operations.
 */
export const assertWalletOwner = async (
  ctx: AuthCtx,
  walletId: string,
  requester?: string,
) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  const sessionAddresses = getSessionAddresses(ctx);
  const candidates = requester ? [requester, ...sessionAddresses] : sessionAddresses;
  if (candidates.length === 0) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const isOwner = candidates.some((addr) => wallet.ownerAddress === addr);
  if (!isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the wallet owner can perform this action" });
  }
  return wallet;
};
