import Link from "next/link";

export default function MenuLink({
  children,
  href,
  className,
}: {
  children: React.ReactNode;
  href: string;
  className?: string | undefined;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 hover:text-foreground ${className && className === "text-white" ? "!bg-gray-900 dark:!bg-white/10 !text-white dark:!text-white !font-medium" : className}`}
    >
      {children}
    </Link>
  );
}
