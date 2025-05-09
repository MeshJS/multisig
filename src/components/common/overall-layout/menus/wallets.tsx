import useUserWallets from "@/hooks/useUserWallets";
import { House, Sparkle, Landmark } from "lucide-react";
import MenuLink from "./menu-link";
import { useRouter } from "next/router";

export default function MenuWallets() {
  const { wallets } = useUserWallets();
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;

  return (
    
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
      <br />
      <MenuLink
        href={`/`}
        className={router.pathname == "/" ? "text-white" : ""}
      >
        <House className="h-6 w-6" />
        <div className="flex items-center gap-2">Home</div>
      </MenuLink>

      <MenuLink
        href={`/features`}
        className={router.pathname == "/features" ? "text-white" : ""}
      >
        <Sparkle className="h-6 w-6" />
        <div className="flex items-center gap-2">Features</div>
      </MenuLink>
      <br />
      {wallets && (
        <div className="my-1">
        <MenuLink
          href={ `${baseUrl}` }
          className={router.pathname.startsWith("/wallets/[wallet]") ? "text-white" : ""}
        >
          <p>
            {wallets
              .filter((wallet) => wallet.id === router.query.wallet)
              .map((wallet) => wallet.name)}
          </p>
        </MenuLink>
        </div>
      )}
      <MenuLink
        href={
          router.pathname.startsWith("/wallets/[wallet]")
            ? `${baseUrl}governance`
            : "/governance"
        }
        className={router.pathname.includes("governance") ? "text-white" : ""}
      >
        <Landmark className="h-6 w-6" />
        Governance
      </MenuLink>
    </nav>
  );
}
