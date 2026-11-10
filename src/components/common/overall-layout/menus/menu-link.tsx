import Link from "next/link";

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
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Prefetching a wallet route would pull the Cardano stack into a light
      // page; see isLightHref.
      prefetch={isLightHref(href) ? undefined : false}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 hover:text-foreground ${active || className === "text-white" ? "!bg-gray-900 dark:!bg-white/10 !text-white dark:!text-white !font-medium" : (className ?? "")}`}
    >
      {children}
    </Link>
  );
}
