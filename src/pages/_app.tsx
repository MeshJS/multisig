import { GeistSans } from "geist/font/sans";
import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";
import { useEffect } from "react";

import { api } from "@/utils/api";

import "@/styles/globals.css";
import "@meshsdk/react/styles.css";
import { MeshProvider } from "@meshsdk/react";
import { Toaster } from "@/components/ui/toaster";
import Metatags from "@/components/ui/metatags";
import RootLayout from "@/components/common/overall-layout/layout";
import { NostrChatProvider } from "@jinglescode/nostr-chat-plugin";

// Import Swagger UI styles globally
import 'swagger-ui-react/swagger-ui.css';
import '@/styles/swagger-overrides.css';

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
    <MeshProvider>
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
    </MeshProvider>
  );
};

export default api.withTRPC(MyApp);
