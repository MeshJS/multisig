export const resourceLinks = {
  about: { label: "About", href: "/about" },
  gettingStarted: { label: "Getting Started", href: "/getting-started" },
  features: { label: "Features", href: "/features" },
  developers: {
    label: "Developers & Bots",
    href: "/about#developers-and-bots",
  },
  mcp: { label: "MCP setup", href: "/docs/mcp" },
  bots: { label: "Bot Setup", href: "/bot-setup" },
  api: { label: "API Docs", href: "/api-docs" },
  dapps: { label: "DApps integration", href: "/dapps" },
  verify: { label: "Document verification", href: "/verify" },
  blog: { label: "Blog", href: "/blog" },
  roadmap: { label: "Roadmap", href: "/roadmap" },
  graph: { label: "Feature graph", href: "/roadmap/graph" },
  demo: { label: "Sign-off demo", href: "/vault" },
} as const;
type ResourceLink = (typeof resourceLinks)[keyof typeof resourceLinks];

export const learnHelpGroups: ReadonlyArray<{
  label: string;
  links: readonly ResourceLink[];
}> = [
  {
    label: "Start here",
    links: [
      resourceLinks.about,
      resourceLinks.gettingStarted,
      resourceLinks.features,
    ],
  },
  {
    label: "Integrate & automate",
    links: [
      resourceLinks.developers,
      resourceLinks.mcp,
      resourceLinks.bots,
      resourceLinks.api,
      resourceLinks.dapps,
    ],
  },
  {
    label: "Explore & verify",
    links: [
      resourceLinks.verify,
      resourceLinks.blog,
      resourceLinks.roadmap,
      resourceLinks.graph,
      resourceLinks.demo,
    ],
  },
];
export function isResourceActive(href: string, asPath: string): boolean {
  const url = new URL(asPath, "https://navigation.invalid");
  const current = url.pathname + url.hash;
  if (href.includes("#")) return current === href;
  if (
    url.hash &&
    Object.values(resourceLinks).some((link) => link.href === current)
  )
    return false;
  return (
    url.pathname === href ||
    (href === "/blog" && url.pathname.startsWith("/blog/"))
  );
}
