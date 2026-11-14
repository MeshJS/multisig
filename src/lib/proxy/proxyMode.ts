/**
 * Which credential a governance action (vote, ballot vote, DRep register,
 * update or retire) should use, given the user's proxy selection and this wallet's proxies.
 *
 * Why this exists: the selected proxy id is persisted globally (IndexedDB),
 * not per wallet, and the wallet's proxy list loads asynchronously. The
 * governance components used to treat "selection not found in the list" as
 * "no proxy" and silently fell back to the wallet's own DRep credential. So a
 * user with Proxy Mode switched on could cast a direct DRep vote without being
 * told — by clicking before the proxy list had loaded, or after opening a
 * different wallet than the one the proxy was picked in. Callers must instead
 * block the action until the mode is "direct" or "proxy".
 */

export type ProxyModeProxy = { id: string };

export type ProxyMode<P extends ProxyModeProxy> =
  /** No proxy selected: act with the wallet's own DRep credential. */
  | { kind: "direct" }
  /** The selected proxy is one of this wallet's active proxies. */
  | { kind: "proxy"; proxy: P }
  /** A proxy is selected but the wallet's proxy list has not loaded yet. */
  | { kind: "loading" }
  /** A proxy is selected but the wallet's proxy list failed to load. */
  | { kind: "error" }
  /** A proxy is selected but it is not an active proxy of this wallet. */
  | { kind: "unavailable" };

export function resolveProxyMode<P extends ProxyModeProxy>(input: {
  selectedProxyId: string | null | undefined;
  proxies: readonly P[] | null | undefined;
  /** The proxy query errored; without this a failure would read as "loading" forever. */
  loadFailed?: boolean;
}): ProxyMode<P> {
  const { selectedProxyId, proxies, loadFailed } = input;
  if (!selectedProxyId) return { kind: "direct" };
  // Without the list we cannot tell whether the selection is valid.
  if (!proxies) return loadFailed ? { kind: "error" } : { kind: "loading" };
  const proxy = proxies.find((p) => p.id === selectedProxyId);
  return proxy ? { kind: "proxy", proxy } : { kind: "unavailable" };
}

/** True when the action must not run: the user meant a proxy we can't use. */
export function isProxyModeBlocked(mode: ProxyMode<ProxyModeProxy>): boolean {
  return mode.kind === "loading" || mode.kind === "error" || mode.kind === "unavailable";
}

/** User-facing explanation for a blocked mode; null when nothing is blocked. */
export function proxyModeBlockedMessage(
  mode: ProxyMode<ProxyModeProxy>,
): { title: string; description: string } | null {
  if (mode.kind === "loading") {
    return {
      title: "Loading proxies",
      description:
        "Proxy Mode is on. Waiting for this wallet's proxies before acting, so the action isn't sent with the wallet's own DRep by mistake.",
    };
  }
  if (mode.kind === "error") {
    return {
      title: "Couldn't load proxies",
      description:
        "Proxy Mode is on, but this wallet's proxies failed to load. Reload to try again, or clear the proxy selection to act with the wallet's own DRep.",
    };
  }
  if (mode.kind === "unavailable") {
    return {
      title: "Selected proxy isn't available",
      description:
        "Proxy Mode is on, but the selected proxy doesn't belong to this wallet or is no longer active. Pick one of this wallet's proxies, or clear the proxy selection to act with the wallet's own DRep.",
    };
  }
  return null;
}

/** A proxy's DRep id, tagged with the proxy it was derived for. */
export type ProxyDRep = { proxyId: string; drepId: string };

/**
 * Whose voting record the governance page shows: the same credential a vote
 * cast from that page would use.
 *
 * Why this exists: the proposal list used `proxyDrepId || walletDrepId`, so
 * with Proxy Mode on it showed the wallet's own DRep votes — headed "Proxy DRep
 * Voting Statistics", and as each proposal's current vote — whenever the proxy
 * id wasn't in hand: while proxies loaded, while the proxy DRep id was still
 * being derived, or when the selection belonged to another wallet. A user
 * could read "already voted Yes" on a proposal the proxy never voted on.
 *
 * In proxy mode the record is the proxy's or nothing; `proxyDrep` only counts
 * when it was derived for the proxy that is selected now, so a stale id from
 * the previously selected proxy is never shown under the new one.
 */
export function governanceDRepView<P extends ProxyModeProxy>(
  mode: ProxyMode<P>,
  input: {
    walletDrepId: string | null | undefined;
    proxyDrep: ProxyDRep | null | undefined;
  },
): { dRepId: string | null; isProxy: boolean } {
  if (mode.kind === "direct") {
    return { dRepId: input.walletDrepId || null, isProxy: false };
  }
  if (mode.kind === "proxy") {
    const { proxyDrep } = input;
    const matches = !!proxyDrep && proxyDrep.proxyId === mode.proxy.id;
    return { dRepId: matches ? proxyDrep.drepId || null : null, isProxy: true };
  }
  return { dRepId: null, isProxy: true };
}
