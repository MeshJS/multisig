import { useRouter } from "next/router";
import MenuLink from "./menu-link";
import { isResourceActive, learnHelpGroups } from "@/data/learn-help";
export default function MenuWallets() {
  const router = useRouter();
  return (
    <div className="grid items-start gap-3 px-2 font-medium lg:px-4">
      <MenuLink href="/wallets" active={router.pathname === "/wallets"}>
        My wallets
      </MenuLink>
      <section aria-label="Learn & Help">
        <h2 className="px-3 py-2 text-sm font-semibold">Learn &amp; Help</h2>
        {learnHelpGroups.map((group) => (
          <div key={group.label} className="mb-3 space-y-1">
            <h3 className="px-3 py-1 text-xs text-muted-foreground">
              {group.label}
            </h3>
            {group.links.map((link) => (
              <MenuLink
                key={link.href}
                href={link.href}
                active={isResourceActive(link.href, router.asPath)}
              >
                {link.label}
              </MenuLink>
            ))}
          </div>
        ))}
      </section>
      <MenuLink
        href="/governance"
        active={router.pathname.startsWith("/governance")}
      >
        Governance
      </MenuLink>
    </div>
  );
}
