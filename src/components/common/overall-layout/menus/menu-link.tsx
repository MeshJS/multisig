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
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${className && className}`}
    >
      {children}
    </Link>
  );
}
