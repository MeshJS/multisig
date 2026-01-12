import useUserWallets from "@/hooks/useUserWallets";
import { Sparkle, Landmark, FolderCode } from "lucide-react";
import MenuLink from "./menu-link";
import { useRouter } from "next/router";

export default function MenuWallets() {
  const { wallets } = useUserWallets();
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;
  const isWalletPath = router.pathname.includes("/wallets/[wallet]");

  return (
    <div className="grid items-start px-2 font-medium lg:px-4">
      <div className="grid items-start space-y-1">
        {/* Section Header */}
        <div className="mt-1 pt-1 space-y-1">
          <div className="px-3 py-1 text-xs font-medium text-muted-foreground">
            Resources
          </div>
        </div>

      <MenuLink
        href={`/features`}
        className={router.pathname == "/features" ? "text-white" : ""}
      >
        <Sparkle className="h-5 w-5" />
        <div className="flex items-center gap-2">Features</div>
      </MenuLink>

      <MenuLink
        href={`/api-docs`}
        className={router.pathname == "/api-docs" ? "text-white" : ""}
      >
        <FolderCode className="h-5 w-5" />
        <div className="flex items-center gap-2">API Docs</div>
      </MenuLink>

      <MenuLink
        href="/governance"
        className={router.pathname.includes("/governance") && !isWalletPath ? "text-white" : ""}
      >
        <Landmark className="h-5 w-5" />
        Governance
      </MenuLink>
      </div>
    </div>
  );
}
