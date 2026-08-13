/**
 * Scope vocabulary for the MCP surface.
 *
 * The MCP specification deliberately defines no scope names — it only defines
 * the machinery (`scopes_supported`, the `scope` challenge parameter, hierarchy
 * handling). These are ours.
 *
 * They are intentionally *not* the same strings as `BOT_SCOPES` in
 * `src/lib/auth/botKey.ts`: bot scopes describe what a bot key may do across the
 * whole REST API, while these describe the much narrower MCP tool surface. The
 * mapping between the two lives in `src/lib/mcp/auth.ts`.
 */
export const MCP_SCOPES = [
  "wallets:read",
  "governance:read",
  "ballots:write",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  "wallets:read":
    "Read your multisig wallets, their pending transactions, spendable UTxOs and proxies.",
  "governance:read":
    "Read governance proposals, your team's internal ballots and rationales, and your DRep voting history.",
  // Names the IPFS side effect explicitly. This string is what the consent
  // screen shows at the moment of the decision, and a pinned rationale is
  // public and effectively permanent — "ballot drafts" alone undersells that.
  "ballots:write":
    "Create and update governance ballot drafts, and publish rationale documents publicly to IPFS. Cannot vote on-chain.",
};

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/** Parse a space-delimited OAuth `scope` string, dropping anything unknown. */
export function parseMcpScopes(scope: string | null | undefined): McpScope[] {
  if (!scope) return [];
  const seen = new Set<McpScope>();
  for (const part of scope.split(/\s+/)) {
    if (part && isMcpScope(part)) seen.add(part);
  }
  return MCP_SCOPES.filter((s) => seen.has(s));
}

export function formatMcpScopes(scopes: readonly McpScope[]): string {
  return scopes.join(" ");
}
