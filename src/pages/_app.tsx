import "@/polyfills/arrayChunk";

import { GeistSans } from "geist/font/sans";
import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";
import Script from "next/script";
import { useRouter } from "next/router";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { env } from "@/env";
import { getRouteSeo, type PageSeo } from "@/lib/seo";

import { api } from "@/utils/api";

import "@/styles/globals.css";
import { Toaster } from "@/components/ui/toaster";
import Metatags from "@/components/ui/metatags";
import SeoFallback from "@/components/ui/seo-fallback";
import PublicShell from "@/components/common/overall-layout/public-shell";
import Loading from "@/components/common/overall-layout/loading";
import {
  hasRememberedWallet,
  isLightRoute,
  useWalletRuntime,
} from "@/lib/wallet-runtime";

type RuntimeComponent = ComponentType<{ children: ReactNode }>;

/**
 * The wallet runtime module, loaded at most once per page lifetime. Kept at
 * module scope so a remount of AppFrame never reloads or unmounts it.
 */
let runtimeModule: RuntimeComponent | null = null;
let runtimeLoading: Promise<RuntimeComponent> | null = null;
function loadRuntime(): Promise<RuntimeComponent> {
  runtimeLoading ??= import("@/components/common/app-runtime").then(
    (m) => {
      runtimeModule = m.default;
      return m.default;
    },
    (error: unknown) => {
      // Forget the failure, so a retry downloads again instead of replaying it.
      runtimeLoading = null;
      throw error;
    },
  );
  return runtimeLoading;
}

/** Scroll position of the page's scroll container. */
const mainScrollTop = () =>
  document.getElementById("main-content")?.scrollTop ?? 0;

/**
 * Light public shell or full wallet runtime — see src/lib/wallet-runtime.ts.
 *
 * Light routes server-render in PublicShell with no Cardano code. Everything
 * else, and any light route once a wallet is remembered or requested, renders
 * inside the runtime, which is loaded on the client and then kept for the
 * rest of the session so the wallet connection survives navigation.
 *
 * The hand-over from PublicShell to the runtime re-mounts the page once (the
 * runtime's MeshProvider has to become its ancestor). The visible costs of
 * that are handled: the scroll position is carried across, pages with input
 * worth keeping hold it outside the component (see /verify), and the wallet
 * picker opens at the connector that was actually clicked.
 */
function AppFrame({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const [Runtime, setRuntime] = useState<RuntimeComponent | null>(
    () => runtimeModule,
  );
  const [failed, setFailed] = useState(false);
  const [restoreScroll, setRestoreScroll] = useState<number | null>(null);
  const requested = useWalletRuntime((s) => s.requested);
  const request = useWalletRuntime((s) => s.request);
  const light = isLightRoute(pathname);
  const needed = requested || !light;

  // A browser that will auto-reconnect a wallet needs the runtime even on a
  // light route, or a returning user would look signed out. Checked after
  // hydration because the server cannot see localStorage.
  useEffect(() => {
    if (hasRememberedWallet()) request();
  }, [request]);

  useEffect(() => {
    if (!needed || Runtime || failed) return;
    let cancelled = false;
    loadRuntime().then(
      (Loaded) => {
        if (cancelled) return;
        setRestoreScroll(mainScrollTop());
        setRuntime(() => Loaded);
      },
      (error: unknown) => {
        console.error("[AppFrame] Could not load the wallet runtime:", error);
        if (cancelled) return;
        // Release the request, so the Connect button works again and the
        // retry below can ask for it.
        useWalletRuntime.setState({ requested: false, openConnect: null });
        setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needed, Runtime, failed]);

  // On a light route the visitor retries by clicking Connect again.
  useEffect(() => {
    if (failed && requested) setFailed(false);
  }, [failed, requested]);

  // Carry the scroll position across the hand-over (see above).
  useLayoutEffect(() => {
    if (restoreScroll === null || !Runtime) return;
    const main = document.getElementById("main-content");
    if (main) main.scrollTop = restoreScroll;
    setRestoreScroll(null);
  }, [Runtime, restoreScroll]);

  if (Runtime) return <Runtime>{children}</Runtime>;
  if (failed && !light) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          The wallet app could not be loaded. Check your connection — or the
          site was just updated and needs a reload.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm"
            onClick={() => setFailed(false)}
          >
            Try again
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
  if (light) return <PublicShell>{children}</PublicShell>;
  // A wallet route before the runtime arrives: the same veil RootLayout shows
  // while it loads a user, rather than an empty page.
  return <Loading />;
}

const MyApp: AppType<{ session: Session | null }> = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  // Define the Geist font variable on <html> too. The font class sits on a div
  // inside the app, but Radix portals (dialogs, dropdowns, the mobile nav
  // sheet) render under <body>, outside it, where Tailwind's base font stack
  // `var(--font-geist-sans), …` resolves to nothing and they fell back to the
  // browser's serif. next/font cannot run in _document, so it is added here;
  // portals only open after hydration, so this is in time.
  useEffect(() => {
    document.documentElement.classList.add(GeistSans.variable);
  }, []);

  // Global Dark Mode Detection
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    // Initial check
    updateTheme(mediaQuery);

    // Listen for changes
    mediaQuery.addEventListener("change", updateTheme);

    return () => mediaQuery.removeEventListener("change", updateTheme);
  }, []);

  // Route-aware SEO. `pathname` is the matched route pattern (available during
  // SSR) used to look up per-page metadata; `asPath` gives the real URL for the
  // canonical / og:url tags (so dynamic routes resolve to the actual path, not
  // a "[id]" pattern).
  const router = useRouter();
  const routeSeo = getRouteSeo(router.pathname);
  const canonicalPath = (router.asPath || "/").split(/[?#]/)[0] || "/";

  // A page can return a fully-resolved `seo` override from its data fetcher
  // (e.g. blog posts via getServerSideProps). It's merged over the route-pattern
  // defaults here so dynamic pages get a server-rendered, per-page <head>.
  const pageSeo = (pageProps as { seo?: PageSeo }).seo;
  const seo = {
    title: pageSeo?.title ?? routeSeo.title,
    description: pageSeo?.description ?? routeSeo.description,
    keywords: pageSeo?.keywords ?? routeSeo.keywords,
    noindex: pageSeo?.noindex ?? routeSeo.noindex,
    image: pageSeo?.image ?? routeSeo.image,
    imageAlt: pageSeo?.imageAlt ?? routeSeo.imageAlt,
    type: pageSeo?.type,
    jsonLd: pageSeo?.jsonLd,
  };

  const umamiWebsiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const umamiScriptUrl =
    env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ?? "https://cloud.umami.is/script.js";

  return (
    <>
      {/* Head tags are part of the server-rendered HTML on every route —
          essential for SEO and social-share scrapers. */}
      <Metatags
        title={seo.title}
        description={seo.description}
        keywords={seo.keywords}
        path={canonicalPath}
        noindex={seo.noindex}
        image={seo.image}
        imageAlt={seo.imageAlt}
        type={seo.type}
        extraJsonLd={seo.jsonLd}
      />
      {/* A <noscript> content fallback so crawlers and LLM fetchers that don't
          run our client bundle still get readable body content. Light public
          routes now server-render their own content as well; wallet routes
          still render a shell until the wallet runtime loads. */}
      <SeoFallback />
      {umamiWebsiteId && (
        <Script
          src={umamiScriptUrl}
          data-website-id={umamiWebsiteId}
          strategy="afterInteractive"
        />
      )}
      <SessionProvider session={session}>
        <div className={GeistSans.className}>
          <div className="flex min-h-[100dvh] w-full flex-col">
            <AppFrame pathname={router.pathname}>
              <Component {...pageProps} />
            </AppFrame>
          </div>
          <Toaster />
        </div>
      </SessionProvider>
    </>
  );
};

export default api.withTRPC(MyApp);
