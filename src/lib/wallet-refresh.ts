/**
 * One wallet refresh at a time, shared by every mounted refresh control.
 *
 * The layout mounts the refresh control twice: a desktop button that is only
 * hidden with CSS on phones, and an item inside the mobile "More actions"
 * menu. Radix unmounts a closed menu's content, so the mobile item mounted
 * fresh on every open. Each instance kept its own "last wallet" ref and
 * in-flight flag, so opening the menu started a second full refresh of the
 * wallet the desktop instance had just loaded: up to four pages of
 * transactions plus one Blockfrost lookup per transaction and per asset,
 * each instance on its own throttle, at twice the rate the throttle exists to
 * hold.
 *
 * The state lives here instead, at module level, so it survives remounts and
 * is shared by every instance:
 *
 *  - `showWallet` records which wallet the app is showing and reports whether
 *    that is a switch. Only a switch (or the first wallet) triggers an
 *    automatic refresh; a remount of the control does not.
 *  - `run` joins a refresh already in flight for the same wallet instead of
 *    starting another, so a second control shows the same spinner.
 *  - A refresh for a wallet the user has since left is "stale", and stays
 *    stale even if they come back (a fresh run starts instead). It stops
 *    issuing lookups and must not write the store's wallet-agnostic fields
 *    (`walletAssets`, `drepInfo`), which would otherwise show the previous
 *    wallet's assets and DRep on the new one.
 */

export interface RefreshContext {
  /** True once the app shows a different wallet than the one being refreshed. */
  isStale: () => boolean;
}

export function createWalletRefreshCoordinator() {
  let shownWalletId: string | null = null;
  // Bumped on every switch. A run is stale once the generation it started in
  // has passed, even if the user has since switched back: by then it may
  // have skipped lookups, and its results are incomplete.
  let generation = 0;
  const inFlight = new Map<
    string,
    { promise: Promise<void>; context: RefreshContext }
  >();

  return {
    /**
     * Record the wallet the app now shows. Returns true when it differs from
     * the one shown before, i.e. the caller should load it.
     */
    showWallet(walletId: string): boolean {
      if (shownWalletId === walletId) return false;
      shownWalletId = walletId;
      generation++;
      return true;
    },

    isRunning(walletId: string): boolean {
      const run = inFlight.get(walletId);
      return run !== undefined && !run.context.isStale();
    },

    /**
     * Run `task` for `walletId`, or join the run already in flight for it.
     * Refreshes of different wallets do not wait on each other: the one the
     * user left goes stale and winds down on its own. A stale run is never
     * joined; a fresh one starts beside it.
     */
    run(
      walletId: string,
      task: (context: RefreshContext) => Promise<void>,
    ): Promise<void> {
      const existing = inFlight.get(walletId);
      if (existing && !existing.context.isStale()) return existing.promise;

      const startedIn = generation;
      const context: RefreshContext = {
        isStale: () => generation !== startedIn || shownWalletId !== walletId,
      };
      // Started on a microtask so the entry is registered before the task can
      // settle, even if it throws synchronously.
      const entry: { promise: Promise<void>; context: RefreshContext } = {
        context,
        promise: Promise.resolve()
          .then(() => task(context))
          .finally(() => {
            // A newer run for the same wallet may have taken the slot.
            if (inFlight.get(walletId) === entry) inFlight.delete(walletId);
          }),
      };
      inFlight.set(walletId, entry);
      return entry.promise;
    },
  };
}

export type WalletRefreshCoordinator = ReturnType<
  typeof createWalletRefreshCoordinator
>;

/** The app-wide instance the refresh controls share. */
export const walletRefreshCoordinator = createWalletRefreshCoordinator();
