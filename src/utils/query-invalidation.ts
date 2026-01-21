/**
 * Query Invalidation Utilities
 * 
 * Provides helper functions for smart query invalidation in tRPC mutations.
 * Only invalidates related queries, not all queries.
 */

import type { RouterOutputs } from "@/utils/api";

/**
 * Cache tags for different data types
 */
export const CACHE_TAGS = {
  USER: "user",
  WALLET: "wallet",
  TRANSACTION: "transaction",
  TRANSACTION_PENDING: "transaction:pending",
  TRANSACTION_HISTORY: "transaction:history",
  PROXY: "proxy",
  BALLOT: "ballot",
} as const;

/**
 * Invalidation helpers for common mutation patterns
 */
export class QueryInvalidation {
  constructor(private utils: ReturnType<typeof import("@/utils/api").api.useUtils>) {}

  /**
   * Invalidate user-related queries
   */
  invalidateUser(address?: string) {
    if (address) {
      this.utils.user.getUserByAddress.invalidate({ address });
    } else {
      this.utils.user.getUserByAddress.invalidate();
    }
  }

  /**
   * Invalidate wallet-related queries
   */
  invalidateWallets(address?: string) {
    if (address) {
      this.utils.wallet.getUserWallets.invalidate({ address });
    } else {
      this.utils.wallet.getUserWallets.invalidate();
    }
  }

  /**
   * Invalidate specific wallet query
   */
  invalidateWallet(walletId: string, address: string) {
    this.utils.wallet.getWallet.invalidate({ walletId, address });
    // Also invalidate wallet list to ensure consistency
    this.invalidateWallets(address);
  }

  /**
   * Invalidate transaction queries for a wallet
   */
  invalidateTransactions(walletId: string) {
    this.utils.transaction.getPendingTransactions.invalidate({ walletId });
    this.utils.transaction.getAllTransactions.invalidate({ walletId });
  }

  /**
   * Invalidate only pending transactions (faster for real-time updates)
   */
  invalidatePendingTransactions(walletId: string) {
    this.utils.transaction.getPendingTransactions.invalidate({ walletId });
  }

  /**
   * Invalidate proxy queries for a wallet
   */
  invalidateProxies(walletId?: string) {
    if (walletId) {
      this.utils.proxy.getProxiesByUserOrWallet.invalidate({ walletId });
    } else {
      this.utils.proxy.getProxiesByUserOrWallet.invalidate();
    }
  }

  /**
   * Invalidate ballot queries for a wallet
   */
  invalidateBallots(walletId: string) {
    this.utils.ballot.getByWallet.invalidate({ walletId });
  }

  /**
   * Invalidate all queries for a wallet (use sparingly)
   */
  invalidateWalletData(walletId: string, address: string) {
    this.invalidateWallet(walletId, address);
    this.invalidateTransactions(walletId);
    this.invalidateProxies(walletId);
    this.invalidateBallots(walletId);
  }
}

/**
 * Helper function to get query invalidation utilities
 * 
 * @example
 * ```ts
 * const utils = api.useUtils();
 * const invalidation = getQueryInvalidation(utils);
 * 
 * // After creating a wallet
 * invalidation.invalidateWallets(userAddress);
 * ```
 */
export function getQueryInvalidation(utils: ReturnType<typeof import("@/utils/api").api.useUtils>) {
  return new QueryInvalidation(utils);
}
