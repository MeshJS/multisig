import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { isResourceActive, learnHelpGroups } from "@/data/learn-help";
import { isLightHref } from "@/lib/wallet-runtime";

/** Landing-page navigation, where the desktop sidebar is intentionally absent. */
export default function LearnHelpDropdown() {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">Learn &amp; Help</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto"
      >
        <DropdownMenuItem asChild>
          <Link prefetch={false} href="/wallets">
            My wallets
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {learnHelpGroups.map((group) => (
          <div key={group.label}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.links.map((link) => (
              <DropdownMenuItem asChild key={link.href}>
                <Link
                  href={link.href}
                  prefetch={isLightHref(link.href) ? undefined : false}
                  aria-current={
                    isResourceActive(link.href, router.asPath)
                      ? "page"
                      : undefined
                  }
                >
                  {link.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/governance">Governance</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
