import Link from "next/link";
import { cn } from "@/lib/utils";

import { isLightHref } from "@/lib/wallet-runtime";

export default function MenuLink({
  children,
  href,
  className,
  active,
}: {
  children: React.ReactNode;
  href: string;
  className?: string | undefined;
  active?: boolean;
}) {
  const isActive = active || className === "text-white";
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      // Prefetching a wallet route would pull the Cardano stack into a light
      // page; see isLightHref.
      prefetch={isLightHref(href) ? undefined : false}
      className={cn(
        "flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
        isActive && "!bg-gray-900 font-medium !text-white dark:!bg-white/10",
      )}
    >
      {children}
    </Link>
  );
}
