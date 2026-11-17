import { Wallet2 } from "lucide-react";
import { useRouter } from "next/router";
import MenuLink from "./menu-link";

/** Global application destinations; resources live in the header and footer. */
export default function MenuWallets() {
  const router = useRouter();
  return (
    <div className="grid items-start gap-1 px-2 font-medium lg:px-4">
      <MenuLink href="/wallets" active={router.pathname === "/wallets"}>
        <Wallet2 className="h-5 w-5 shrink-0" aria-hidden="true" />
        My wallets
      </MenuLink>
    </div>
  );
}
