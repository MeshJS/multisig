import useUserWallets from "@/hooks/useUserWallets";
import {House, Sparkle, Scale } from "lucide-react";
import MenuLink from "./menu-link";
import { useRouter } from "next/router";

export default function MenuWallets() {
  const { wallets } = useUserWallets();
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
      <MenuLink
        href={`/`}
        className={router.pathname == "/" ? "text-white" : ""}
      >
        <House className="h-4 w-4" />
        <div className="flex items-center gap-2">Home</div>
      </MenuLink>

      <MenuLink
        href={`/features`}
        className={router.pathname == "/features" ? "text-white" : ""}
      >
        <Sparkle className="h-4 w-4" />
        <div className="flex items-center gap-2">Features</div>
      </MenuLink>
      <br />
      {wallets && (
        <p>
          {wallets
            .filter((wallet) => wallet.id === router.query.wallet)
            .map((wallet) => wallet.name)}
        </p>
      )}
      <MenuLink
        href={
          router.pathname.startsWith("/wallets/[wallet]")
            ? `${baseUrl}governance`
            : "/governance"
        }
        className={router.pathname.includes("governance") ? "text-white" : ""}
      >
        <Scale className="h-4 w-4" />
        Governance
      </MenuLink>
    </nav>
  );
}