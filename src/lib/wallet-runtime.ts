import { create } from "zustand";

/**
 * When the wallet runtime — MeshProvider, the Cardano libraries and the full
 * wallet layout — is loaded.
 *
 * It is about 2 MB of gzipped JavaScript and none of it can render on the
 * server, so loading it unconditionally made every page, marketing pages
 * included, an empty shell until that download finished. Instead:
 *
 *  - Light routes render server-side in a light public shell, and the runtime
 *    is not loaded at all unless the visitor needs it.
 *  - The runtime loads when the route is not light, when this browser has a
 *    remembered wallet connection to restore, or when the visitor asks to
 *    connect. Once loaded it stays loaded for the rest of the session, so the
 *    wallet connection survives navigation.
 */

/**
 * Public routes that need no wallet runtime to render. A page belongs here
 * only if it imports nothing from the Cardano stack and works with no wallet
 * context; scripts/check-bundle-budget.mjs holds them to a tight size budget,
 * which is what catches one that starts importing the stack.
 */
export const LIGHT_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/features",
  "/roadmap",
  "/roadmap/graph",
  "/governance",
  "/governance/drep",
  "/governance/drep/[id]",
  "/verify",
  "/blog",
  "/blog/[slug]",
  "/vault",
  "/bot-setup",
  "/404",
  "/500",
  "/_error",
]);

export const isLightRoute = (pathname: string): boolean =>
  LIGHT_ROUTES.has(pathname);

const LIGHT_ROUTE_PATTERNS = [...LIGHT_ROUTES].map(
  (route) =>
    new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}/?$`),
);

/**
 * Whether a concrete URL (`/blog/my-post`, not `/blog/[slug]`) is a light
 * route. Links use this to decide whether to prefetch: Next prefetches every
 * in-view link in production, and prefetching a wallet route downloads the
 * Cardano stack (~2 MB gz) on a page that otherwise never loads it.
 */
export function isLightHref(href: string): boolean {
  const path = href.split(/[?#]/)[0] ?? href;
  return LIGHT_ROUTE_PATTERNS.some((pattern) => pattern.test(path));
}

/** localStorage key @meshsdk/react uses to restore a connection on load. */
const MESH_PERSIST_KEY = "mesh-wallet-persist";

/**
 * Whether this browser will auto-reconnect a wallet. If so the runtime has to
 * load even on a light route, or the returning user would look signed out.
 */
export function hasRememberedWallet(): boolean {
  try {
    const raw = window.localStorage.getItem(MESH_PERSIST_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { walletName?: unknown } | null;
    // Mesh itself discards a remembered UTXOS session rather than restoring it.
    return (
      typeof parsed?.walletName === "string" && parsed.walletName !== "utxos"
    );
  } catch {
    return false;
  }
}

/** Anchor for a connector that does not name one. */
export const DEFAULT_CONNECT_ANCHOR = "default";
/** The header connector, in both the public shell and the wallet layout. */
export const HEADER_CONNECT_ANCHOR = "header";

interface WalletRuntimeState {
  /** Something asked for the runtime; the frame loads it. */
  requested: boolean;
  /** The runtime has mounted and wallet components can render. */
  active: boolean;
  /**
   * Open the wallet picker as soon as the runtime is up — at the connector the
   * visitor actually clicked (a page can have several), named by its anchor.
   */
  openConnect: string | null;
  request: (options?: { openConnect?: boolean; anchor?: string }) => void;
  markActive: () => void;
  /** True once, for the connector whose anchor was clicked. */
  consumeOpenConnect: (anchor: string) => boolean;
}

export const useWalletRuntime = create<WalletRuntimeState>()((set, get) => ({
  requested: false,
  active: false,
  openConnect: null,
  request: (options) =>
    set({
      requested: true,
      ...(options?.openConnect
        ? { openConnect: options.anchor ?? DEFAULT_CONNECT_ANCHOR }
        : {}),
    }),
  markActive: () => set({ active: true, requested: true }),
  consumeOpenConnect: (anchor) => {
    if (get().openConnect !== anchor) return false;
    set({ openConnect: null });
    return true;
  },
}));
