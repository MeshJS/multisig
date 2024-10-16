import { House, Sparkle } from "lucide-react";
import { useRouter } from "next/router";
import MenuLink from "./menu-link";

export default function MenuHomepage() {
  const router = useRouter();

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
      <MenuLink
        href={`/`}
        className={router.pathname == "/" ? "text-white" : ""}
      >
        <House className="h-4 w-4" />
        <div className="flex items-center gap-2">Home</div>
      </MenuLink>
      <MenuLink
        href={`/features`}
        className={router.pathname == "/features" ? "text-white" : ""}
      >
        <Sparkle className="h-4 w-4" />
        <div className="flex items-center gap-2">Features</div>
      </MenuLink>
    </nav>
  );
}
