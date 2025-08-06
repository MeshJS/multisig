import useUserWallets from "@/hooks/useUserWallets";
import { House, Sparkle, Landmark, FolderCode, Users } from "lucide-react";
import MenuLink from "./menu-link";
import { useRouter } from "next/router";

export default function MenuWallets() {
  const { wallets } = useUserWallets();
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4 space-y-1">
      <MenuLink
        href={`/`}
        className={
          router.pathname == "/" || 
          router.pathname.startsWith("/wallets") && !router.pathname.startsWith("/wallets/[wallet]")
            ? "text-white" 
            : ""
        }
      >
        <House className="h-5 w-5" />
        <div className="flex items-center gap-2">Home</div>
      </MenuLink>

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

      {wallets && (
        <div className="mt-6 pt-4 border-t border-gray-200/30 dark:border-white/[0.03]">
          <MenuLink
            href={`${baseUrl}`}
            className={
              router.pathname.startsWith("/wallets/[wallet]")
                ? "text-white"
                : ""
            }
          >
            <p>
              {wallets
                .filter((wallet) => wallet.id === router.query.wallet)
                .map((wallet) => wallet.name)}
            </p>
          </MenuLink>
        </div>
      )}
      
      {/* Global Governance - only when NOT in wallet context */}
      {!router.pathname.startsWith("/wallets/[wallet]") && (
        <MenuLink
          href="/governance"
          className={router.pathname.includes("governance") ? "text-white" : ""}
        >
          <Landmark className="h-5 w-5" />
          Governance
        </MenuLink>
      )}
      
      {/* Global Crowdfund - only when NOT in wallet context */}
      {!router.pathname.startsWith("/wallets/[wallet]") && (
        <MenuLink
          href="/crowdfund"
          className={router.pathname.includes("crowdfund") ? "text-white" : ""}
        >
          <Users className="h-5 w-5" />
          Crowdfund
        </MenuLink>
      )}
    </nav>
  );
}
