import Link from "next/link";
import McpGuide from "@/components/pages/docs/mcp-guide";
export default function McpDocumentation() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 sm:py-12">
      <h1 className="text-3xl font-bold">MCP setup guide</h1>
      <p className="mt-3 text-muted-foreground">
        Connect an AI client to Mesh Multisig and control what it can access.
      </p>
      <McpGuide />
      <nav
        aria-label="Related resources"
        className="mt-8 flex flex-wrap gap-4 text-sm underline underline-offset-4"
      >
        <Link href="/about#developers-and-bots">Developers &amp; Bots</Link>
        <Link prefetch={false} href="/api-docs">
          API Docs
        </Link>
        <Link href="/bot-setup">Bot Setup</Link>
      </nav>
    </div>
  );
}
