import { describe, expect, it } from "@jest/globals";
import { existsSync } from "fs";
import { join } from "path";

import { MCP_TOOLS, toolsForScopes } from "@/lib/mcp/tools";
import { MCP_SCOPES, isMcpScope, parseMcpScopes } from "@/lib/mcp/scopes";
import { mcpScopesForBot } from "@/lib/mcp/auth";
import type { BotScope } from "@/lib/auth/botKey";

const V1_DIR = join(process.cwd(), "src", "pages", "api", "v1");

describe("MCP tool registry", () => {
  it("has unique tool names", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps a stable, deterministic order", () => {
    // tools/list order is caller-visible and feeds prompt caching, so it must
    // not depend on object iteration or filesystem order.
    expect(MCP_TOOLS.map((t) => t.name)).toEqual([
      "multisig_whoami",
      "multisig_list_wallets",
      "multisig_list_pending_transactions",
      "multisig_list_free_utxos",
      "multisig_list_proxies",
      "multisig_proxy_drep_info",
      "multisig_lookup_wallet",
      "governance_list_active_proposals",
      "ballot_upsert",
    ]);
  });

  it("only declares scopes from the published catalogue", () => {
    for (const tool of MCP_TOOLS) {
      expect(isMcpScope(tool.scope)).toBe(true);
    }
  });

  it("points every wrapped tool at a v1 handler that exists", () => {
    // A handler rename or deletion must break CI rather than 500 at runtime.
    for (const tool of MCP_TOOLS) {
      if (tool.v1Path === null) continue;
      expect(existsSync(join(V1_DIR, tool.v1Path))).toBe(true);
    }
  });

  it("exposes no tool that can sign, spend or broadcast", () => {
    // This release is read-only plus ballot drafts. Any new write tool must be a
    // deliberate decision that updates this test, not a quiet registry addition.
    const writable = MCP_TOOLS.filter((t) => !t.annotations.readOnlyHint);
    expect(writable.map((t) => t.name)).toEqual(["ballot_upsert"]);

    const forbidden = [
      "signTransaction",
      "addTransaction",
      "proxySpend",
      "proxyVote",
      "proxyCleanup",
      "createWallet",
      "botStakeCertificate",
      "botDRepCertificate",
      "submitDatum",
      "exportWallet",
    ];
    for (const tool of MCP_TOOLS) {
      for (const banned of forbidden) {
        expect(tool.v1Path ?? "").not.toContain(banned);
      }
    }
  });

  it("marks the one write tool as non-destructive", () => {
    const ballot = MCP_TOOLS.find((t) => t.name === "ballot_upsert");
    expect(ballot?.annotations.destructiveHint).toBe(false);
    expect(ballot?.annotations.idempotentHint).toBe(true);
  });

  it("gives every tool a closed input schema", () => {
    // additionalProperties:false makes a mistyped argument fail loudly in ajv
    // instead of being silently ignored.
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("caps the governance page size", () => {
    const tool = MCP_TOOLS.find(
      (t) => t.name === "governance_list_active_proposals",
    );
    const props = tool?.inputSchema.properties as Record<
      string,
      { maximum?: number }
    >;
    expect(props.count?.maximum).toBe(25);
  });
});

describe("scope filtering", () => {
  it("hides tools the caller has no scope for", () => {
    const names = toolsForScopes(["wallets:read"]).map((t) => t.name);
    expect(names).toContain("multisig_list_wallets");
    expect(names).not.toContain("ballot_upsert");
    expect(names).not.toContain("governance_list_active_proposals");
  });

  it("returns nothing for an empty scope set", () => {
    expect(toolsForScopes([])).toHaveLength(0);
  });

  it("returns every tool for the full scope set", () => {
    expect(toolsForScopes(MCP_SCOPES)).toHaveLength(MCP_TOOLS.length);
  });

  it("covers every tool with at least one grantable scope", () => {
    const reachable = new Set(
      MCP_SCOPES.flatMap((s) => toolsForScopes([s]).map((t) => t.name)),
    );
    expect(reachable.size).toBe(MCP_TOOLS.length);
  });
});

describe("scope parsing", () => {
  it("drops unknown scopes rather than failing", () => {
    expect(parseMcpScopes("wallets:read bogus ballots:write")).toEqual([
      "wallets:read",
      "ballots:write",
    ]);
  });

  it("normalises to catalogue order regardless of input order", () => {
    expect(parseMcpScopes("ballots:write wallets:read")).toEqual([
      "wallets:read",
      "ballots:write",
    ]);
  });

  it("treats empty input as no scopes", () => {
    expect(parseMcpScopes("")).toEqual([]);
    expect(parseMcpScopes(null)).toEqual([]);
  });
});

describe("bot scope projection", () => {
  it("never grants MCP reach a bot key lacks over REST", () => {
    expect(mcpScopesForBot([])).toEqual([]);
    expect(mcpScopesForBot(["multisig:read"] as BotScope[])).toEqual([
      "wallets:read",
    ]);
    // multisig:sign must not imply any MCP scope — there is no signing surface.
    expect(mcpScopesForBot(["multisig:sign"] as BotScope[])).toEqual([]);
  });

  it("maps the full bot scope set onto the full MCP set", () => {
    const all = [
      "multisig:read",
      "governance:read",
      "ballot:write",
    ] as BotScope[];
    expect(mcpScopesForBot(all)).toEqual([
      "wallets:read",
      "governance:read",
      "ballots:write",
    ]);
  });
});
