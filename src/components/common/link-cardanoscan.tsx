import { env } from "@/env";
import Link from "next/link";

export default function LinkCardanoscan({
  children,
  url,
  className,
}: {
  children: React.ReactNode;
  url: string;
  className?: string;
}) {
  return (
    <Link
      className={className}
      href={`https://${env.NEXT_PUBLIC_CARDANO_NETWORK == "preprod" ? "preprod." : ""}cardanoscan.io/${url}`}
      target="_blank"
    >
      {children}
    </Link>
  );
}
