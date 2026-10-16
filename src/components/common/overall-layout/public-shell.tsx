import type { ReactNode } from "react";
import { useRouter } from "next/router";

import ConnectWalletSlot from "@/components/common/connect-wallet-slot";
import LayoutFrame, {
  SidebarHomeLink,
} from "@/components/common/overall-layout/layout-frame";
import MenuWallets from "@/components/common/overall-layout/menus/wallets";
import { MobileNavigation } from "@/components/ui/mobile-navigation";

/**
 * The layout a signed-out visitor sees on a light public route, server-
 * rendered and free of the Cardano stack.
 *
 * It reproduces what RootLayout renders for a visitor with no wallet — same
 * frame, same signed-out header and sidebar — so swapping to the full layout
 * when the wallet runtime loads changes nothing on screen but the connector.
 */
export default function PublicShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isHomepage = router.pathname === "/";

  return (
    <LayoutFrame
      compactLogo={!isHomepage}
      showSidebar={!isHomepage}
      showFooter
      mobileNav={
        !isHomepage && (
          <MobileNavigation showWalletMenu={false} isLoggedIn={false} />
        )
      }
      headerRight={
        // On the homepage the hero carries the connector.
        isHomepage ? null : <ConnectWalletSlot variant="compact" />
      }
      sidebar={
        <>
          <SidebarHomeLink />
          <div className="mt-4">
            <MenuWallets />
          </div>
        </>
      }
    >
      {children}
    </LayoutFrame>
  );
}
