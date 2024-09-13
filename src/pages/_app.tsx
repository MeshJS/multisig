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
import RootLayout from "@/components/common/layout";
import Metatags from "@/components/common/metatags";

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
