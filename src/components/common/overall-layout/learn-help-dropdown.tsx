import Link from "next/link";
import { CircleHelp, ExternalLink, MessageCircle } from "lucide-react";
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
import { isResourceActive, helpMenuGroups } from "@/data/learn-help";
import { isLightHref } from "@/lib/wallet-runtime";
import ResourceIcon from "./resource-icon";

/** Persistent help access in both the public and wallet layouts. */
export default function LearnHelpDropdown() {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Help & resources"
          title="Help & resources"
          className="h-11 min-w-11 gap-2 px-2 lg:px-3"
        >
          <CircleHelp className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline">Help &amp; resources</span>
          <span className="hidden sm:inline lg:hidden">Help</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="Help & resources"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain"
      >
        {helpMenuGroups.map((group) => (
          <div key={group.label}>
            <DropdownMenuLabel className="pb-2 pt-3 text-xs uppercase tracking-wide text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
            {group.links.map((link) => (
              <DropdownMenuItem asChild key={link.href}>
                <Link
                  href={link.href}
                  className="min-h-11 gap-3 aria-[current=page]:bg-accent aria-[current=page]:font-medium"
                  prefetch={isLightHref(link.href) ? undefined : false}
                  aria-current={
                    isResourceActive(link.href, router.asPath)
                      ? "page"
                      : undefined
                  }
                >
                  <ResourceIcon href={link.href} />
                  {link.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a
            href="https://discord.gg/dH48jH3BKa"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 gap-3"
          >
            <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            Community support
            <ExternalLink
              className="ml-auto h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
