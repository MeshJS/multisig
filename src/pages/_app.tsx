import "@/polyfills/arrayChunk";

import { GeistSans } from "geist/font/sans";
import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";
import Script from "next/script";
import { useRouter } from "next/router";
import { useEffect } from "react";
import dynamic from "next/dynamic";

import { env } from "@/env";
import { getRouteSeo, type PageSeo } from "@/lib/seo";

import { api } from "@/utils/api";

import "@/styles/globals.css";
import "swagger-ui-react/swagger-ui.css";
import "@/styles/swagger-overrides.css";
import { Toaster } from "@/components/ui/toaster";
import Metatags from "@/components/ui/metatags";
import RootLayout from "@/components/common/overall-layout/layout";

// MeshProvider pulls in dependencies that assume a browser/webpack env.
// Load it client-side only (including its styles) to avoid SSR/runtime issues.
const MeshProviderNoSSR = dynamic(
  () => import("@/components/common/MeshProviderClient"),
  { ssr: false },
);

const MyApp: AppType<{ session: Session | null }> = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  // Global Dark Mode Detection
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    
    // Initial check
    updateTheme(mediaQuery);
    
    // Listen for changes
    mediaQuery.addEventListener('change', updateTheme);
    
    return () => mediaQuery.removeEventListener('change', updateTheme);
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
    image: pageSeo?.image,
    type: pageSeo?.type,
    jsonLd: pageSeo?.jsonLd,
  };

  const umamiWebsiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const umamiScriptUrl =
    env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ?? "https://cloud.umami.is/script.js";

  return (
    <>
      {/* Rendered outside MeshProviderNoSSR (which is ssr:false) so the head
          tags are part of the server-rendered HTML — essential for SEO and
          social-share scrapers. */}
      <Metatags
        title={seo.title}
        description={seo.description}
        keywords={seo.keywords}
        path={canonicalPath}
        noindex={seo.noindex}
        image={seo.image}
        type={seo.type}
        extraJsonLd={seo.jsonLd}
      />
      <MeshProviderNoSSR>
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
              <RootLayout>
                <Component {...pageProps} />
              </RootLayout>
            </div>
            <Toaster />
          </div>
        </SessionProvider>
      </MeshProviderNoSSR>
    </>
  );
};

export default api.withTRPC(MyApp);
