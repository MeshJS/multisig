import { GeistSans } from "geist/font/sans";
import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";

import { api } from "@/utils/api";

import "@/styles/globals.css";
import "@meshsdk/react/styles.css";
import { MeshProvider } from "@meshsdk/react";
import LayoutRoot from "@/components/layout/root";
import { Toaster } from "@/components/ui/toaster";
import Metatags from "@/components/common/metatags";
import RootLayout from "@/components/common/overall-layout/layout";

const MyApp: AppType<{ session: Session | null }> = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  return (
    <MeshProvider>
      <SessionProvider session={session}>
        <div className={GeistSans.className}>
          <LayoutRoot>
            <RootLayout>
              <Component {...pageProps} />
            </RootLayout>
          </LayoutRoot>
          <Toaster />
          <Metatags />
        </div>
      </SessionProvider>
    </MeshProvider>
  );
};

export default api.withTRPC(MyApp);
