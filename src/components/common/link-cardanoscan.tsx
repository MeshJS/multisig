import { useSiteStore } from "@/lib/zustand/site";
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
  const network = useSiteStore((state) => state.network);
  return (
    <Link
      className={className}
      href={`https://${network == 0 ? "preprod." : ""}cardanoscan.io/${url}`}
      target="_blank"
    >
      {children}
    </Link>
  );
}
