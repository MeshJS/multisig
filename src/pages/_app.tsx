import "@/polyfills/arrayChunk";

import { GeistSans } from "geist/font/sans";
import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";
import { useEffect } from "react";
import dynamic from "next/dynamic";

import { api } from "@/utils/api";

import "@/styles/globals.css";
import "@meshsdk/react/styles.css";
import { Toaster } from "@/components/ui/toaster";
import Metatags from "@/components/ui/metatags";
import RootLayout from "@/components/common/overall-layout/layout";
import { NostrChatProvider } from "@jinglescode/nostr-chat-plugin";

import "swagger-ui-react/swagger-ui.css";
import "../styles/swagger-overrides.css";

// MeshProvider pulls in dependencies that assume a browser/webpack env.
// Load it client-side only to avoid SSR/runtime issues in Next.js dev/SSR.
const MeshProviderNoSSR = dynamic(
  () => import("@meshsdk/react").then((m) => m.MeshProvider),
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

  return (
    <MeshProviderNoSSR>
      <SessionProvider session={session}>
        <NostrChatProvider>
          <div className={GeistSans.className}>
            <div className="flex min-h-screen w-full flex-col">
              <RootLayout>
                <Component {...pageProps} />
              </RootLayout>
            </div>
            <Toaster />
            <Metatags />
          </div>
        </NostrChatProvider>
      </SessionProvider>
    </MeshProviderNoSSR>
  );
};

export default api.withTRPC(MyApp);
