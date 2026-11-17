import {
  BookOpen,
  Bot,
  Braces,
  FileCheck2,
  FileCode2,
  FileSignature,
  Info,
  Landmark,
  Map,
  Network,
  Newspaper,
  Plug,
  Shapes,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ResourceLink } from "@/data/learn-help";

// Destination icons for the persistent Help & resources menu.
const icons: Record<ResourceLink["href"], LucideIcon> = {
  "/about": Info,
  "/getting-started": BookOpen,
  "/features": Sparkles,
  "/about#developers-and-bots": Braces,
  "/docs/mcp": Plug,
  "/bot-setup": Bot,
  "/api-docs": FileCode2,
  "/dapps": Shapes,
  "/verify": FileCheck2,
  "/governance": Landmark,
  "/blog": Newspaper,
  "/roadmap": Map,
  "/roadmap/graph": Network,
  "/vault": FileSignature,
};

export default function ResourceIcon({ href }: { href: ResourceLink["href"] }) {
  const Icon = icons[href];
  return <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />;
}
