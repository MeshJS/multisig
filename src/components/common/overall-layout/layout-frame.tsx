import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { Background } from "@/components/ui/background";
import { useAppearanceStore } from "@/lib/zustand/appearance";
import { useGraphicsTier } from "@/hooks/useGraphicsTier";
import Logo from "@/components/common/overall-layout/logo";
import SiteFooter from "@/components/common/overall-layout/site-footer";

/**
 * The site chrome — background, header, sidebar, main, footer — with no
 * wallet logic in it.
 *
 * Two layouts render through this so they cannot drift apart: the full
 * wallet layout (RootLayout, loaded with the Cardano stack) and the light
 * public shell (PublicShell, server-rendered without it). Everything wallet-
 * specific arrives through the slots.
 */
export default function LayoutFrame({
  children,
  mobileNav,
  headerRight,
  sidebar,
  showSidebar,
  compactLogo,
  showFooter,
  overlay,
}: {
  children: ReactNode;
  /** Mobile menu button, or null to hide it. */
  mobileNav?: ReactNode;
  /** Right-hand header controls. */
  headerRight?: ReactNode;
  /** Sidebar contents; rendered only when `showSidebar`. */
  sidebar?: ReactNode;
  showSidebar: boolean;
  /**
   * Logo block layout: centred on mobile with a fixed sidebar width on
   * larger screens (true), or natural width for the bare homepage (false).
   */
  compactLogo: boolean;
  showFooter: boolean;
  /** Full-screen layers: loading veils, modals. */
  overlay?: ReactNode;
}) {
  // How much background to render: hardware detection by default, overridable
  // in profile → Appearance. `resolved` is false until detection has run on the
  // client, so the server markup and the first client paint agree (no hydration
  // mismatch) and no WebGL surface mounts before we know the device can take it.
  const backgroundPreset = useAppearanceStore((s) => s.backgroundPreset);
  const { features: gfx, resolved: gfxResolved } = useGraphicsTier();

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden">
      {/* App background. The aurora itself is cheap enough to render anywhere;
          the hardware tier decides whether its keyframes and pointer parallax
          run (profile → Appearance overrides it). Renders on every route
          including the homepage, behind the homepage's own hero background. */}
      {gfxResolved && gfx.background && (
        <div className="pointer-events-none fixed inset-0 -z-10">
          <Background
            variant="aurora"
            preset={backgroundPreset}
            animated={gfx.auroraAnimated}
            parallax={gfx.auroraParallax}
            className="opacity-50"
          />
        </div>
      )}
      {/* Skip link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      {overlay}

      {/* Header - full width, always on top */}
      <header
        className="pointer-events-auto relative z-[100] border-b border-gray-300/50 bg-muted/40 pl-2 pr-4 dark:border-white/[0.03] lg:pl-4 lg:pr-6"
        data-header="main"
      >
        <div className="flex h-14 items-center gap-4 lg:h-16">
          {mobileNav}

          {/* Logo - in fixed-width container matching sidebar width */}
          <div
            className={`flex items-center md:w-[260px] lg:w-[280px] ${compactLogo ? "flex-1 justify-center md:flex-none md:justify-start" : ""}`}
          >
            <Link
              href="/"
              className="flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 md:px-4"
            >
              <Logo />
              <span
                className="select-none font-medium tracking-[-0.01em]"
                style={{ fontSize: "17px" }}
              >
                Multisig Platform
              </span>
            </Link>
          </div>

          {/* Right: Control buttons */}
          <div className="ml-auto flex items-center gap-2">{headerRight}</div>
        </div>
      </header>

      {/* Content area with sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <aside className="hidden w-[260px] border-r border-gray-300/50 bg-muted/40 dark:border-white/[0.03] md:block lg:w-[280px]">
            <div className="flex h-full max-h-[100dvh] flex-col">
              <nav className="flex-1 overflow-y-auto pt-2">
                <div className="flex flex-col">{sidebar}</div>
              </nav>
              <div className="mt-auto p-4" />
            </div>
          </aside>
        )}

        {/* Main content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 focus:outline-none md:p-8"
        >
          {/* When the marketing footer is shown, keep page content + footer in a
              non-shrinking flex column so a `min-h-screen` page root can't be
              flex-shrunk by <main> (which would let content overflow under the
              footer). `contents` is a no-op passthrough for app pages. */}
          <div className={showFooter ? "flex shrink-0 flex-col gap-4" : "contents"}>
            {children}
            {showFooter && <SiteFooter />}
          </div>
        </main>
      </div>
    </div>
  );
}

/** The sidebar "Home" link shown to signed-out visitors. */
export function SidebarHomeLink() {
  const router = useRouter();
  return (
    <div className="px-2 lg:px-4">
      <div className="space-y-1">
        <Link
          href="/"
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 ${
            router.pathname === "/"
              ? "text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <span>Home</span>
        </Link>
      </div>
    </div>
  );
}
