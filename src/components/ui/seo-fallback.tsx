import {
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  routeSeo,
  absoluteUrl,
} from "@/lib/seo";

/**
 * Server-rendered, no-JavaScript content fallback for crawlers and LLM fetchers.
 *
 * The app is a client-only SPA: the whole UI lives behind an `ssr:false`
 * MeshProvider boundary (the wallet SDK assumes a browser), so the server HTML
 * body is just an empty `<div id="__next">`. A consumer that doesn't execute
 * JavaScript — search-engine crawlers, social unfurlers, ChatGPT's URL fetcher /
 * GPTBot, `curl` — therefore can't tell what the site is.
 *
 * This block renders inside <noscript>, so real (JS-enabled) visitors never see
 * it, while no-JS consumers get a readable description of the product plus links
 * to every public surface. Copy and links derive from @/lib/seo so they stay in
 * sync with the page metadata and sitemap. Absolute URLs (via {@link absoluteUrl})
 * point at the canonical host, consolidating link equity there.
 */

// Public, indexable surfaces, in nav order. Labels mirror the routeSeo titles;
// the longer per-link blurb is pulled from routeSeo at render time.
const FALLBACK_LINKS = [
  { path: "/features", label: "Features" },
  { path: "/roadmap", label: "Roadmap" },
  { path: "/governance", label: "Cardano Governance" },
  { path: "/governance/drep", label: "DRep Explorer" },
  { path: "/api-docs", label: "API & Bot Documentation" },
  { path: "/dapps", label: "DApps" },
  { path: "/wallets/import-wallet", label: "Import a Multisig Wallet" },
] as const;

// Machine-readable entry points, so an AI agent that lands on the homepage HTML
// (not just /llms.txt) can discover how to drive the bot API.
const BOT_API_LINKS = [
  {
    path: "/llms.txt",
    label: "llms.txt",
    blurb: "AI-oriented overview of the site and bot API, with a quickstart.",
  },
  {
    path: "/api/swagger",
    label: "OpenAPI 3.0 spec (JSON)",
    blurb: "Machine-readable definition of every bot endpoint.",
  },
  {
    path: "/api/skill",
    label: "Agent skill (Markdown)",
    blurb: "Downloadable skill describing the full bot workflow.",
  },
  {
    path: "/api-docs",
    label: "Interactive API docs",
    blurb: "Human Swagger UI with a wallet-based token generator.",
  },
] as const;

const EXTERNAL_LINKS = [
  { href: "https://github.com/MeshJS/multisig", label: "Source code (GitHub)" },
  { href: "https://meshjs.dev", label: "Mesh SDK" },
  { href: "https://discord.gg/dH48jH3BKa", label: "Community (Discord)" },
] as const;

export default function SeoFallback() {
  return (
    <noscript>
      <main>
        <h1>Manage Cardano Treasuries with Multisig Security</h1>
        <p>{DEFAULT_DESCRIPTION}</p>
        <p>
          {SITE_NAME} is a free, open-source, Cardano-native wallet built by Mesh.
          Secure treasuries, participate in governance, and collaborate with M-of-N
          multi-signature approvals — every transaction requires a quorum of
          signers, so no single key can move funds alone.
        </p>

        <h2>What you can do</h2>
        <ul>
          <li>Create an M-of-N multi-signature wallet and invite co-signers.</li>
          <li>Review and co-sign transactions with a required approval threshold.</li>
          <li>Vote on Cardano governance proposals and register as a DRep.</li>
          <li>Delegate stake and earn rewards from the treasury.</li>
          <li>Automate signing with the REST API and bot integrations.</li>
          <li>Import an existing multisig wallet and keep collaborating.</li>
        </ul>

        <h2>Explore</h2>
        <ul>
          {FALLBACK_LINKS.map((link) => (
            <li key={link.path}>
              <a href={absoluteUrl(link.path)}>{link.label}</a>
              {routeSeo[link.path]?.description
                ? ` — ${routeSeo[link.path]?.description}`
                : null}
            </li>
          ))}
        </ul>

        <h2>Bot API (for AI agents)</h2>
        <ul>
          {BOT_API_LINKS.map((link) => (
            <li key={link.path}>
              <a href={absoluteUrl(link.path)}>{link.label}</a> — {link.blurb}
            </li>
          ))}
        </ul>

        <h2>Resources</h2>
        <ul>
          {EXTERNAL_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </main>
    </noscript>
  );
}
