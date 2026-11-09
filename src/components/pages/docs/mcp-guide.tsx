import Link from "next/link";
import CardUI from "@/components/ui/card-content";
import { MCP_TOOL_SUMMARIES } from "@/data/mcp-tools";
import { MCP_SCOPES } from "@/lib/mcp/scopes";
import { SITE_URL } from "@/lib/seo";
const MCP_ENDPOINT = SITE_URL + "/api/mcp";
export default function McpGuide() {
  return (
    <div className="mt-8" id="connect-mcp">
      <CardUI
        title="Connect an AI agent (MCP)"
        description="An open Model Context Protocol endpoint — works with any MCP-capable client, no vendor lock-in."
      >
        <div className="mt-4 space-y-5 text-sm">
          <ol className="space-y-4">
            {/* The GUI path comes first and in full. Leading with a JSON
                      config file sent desktop and web users hunting for a file
                      their client does not have. */}
            <li className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  1
                </span>
                <span className="font-medium">Add the connector</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                This is the only thing you need — there is no API key, because
                the server advertises OAuth and your client discovers the rest:
              </p>
              <div className="ml-7 flex flex-col gap-1">
                <code className="block break-all rounded bg-muted p-3 text-xs">
                  {MCP_ENDPOINT}
                </code>
              </div>

              <div className="ml-7 mt-3 flex flex-col gap-3 text-xs">
                <div>
                  <p className="font-medium text-foreground">
                    In an app with a connector screen
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Claude (desktop or web) and most other assistant apps: open{" "}
                    <span className="text-foreground">
                      Settings → Connectors
                    </span>
                    , choose{" "}
                    <span className="text-foreground">
                      Add custom connector
                    </span>
                    , paste the URL above, and connect. A browser window opens
                    for step 2. Nothing to install and no file to edit.
                  </p>
                </div>

                <div>
                  <p className="font-medium text-foreground">
                    In a client that reads a config file
                  </p>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-3">
                    {`{
  "mcpServers": {
    "mesh-multisig": {
      "type": "http",
      "url": "${MCP_ENDPOINT}"
    }
  }
}`}
                  </pre>
                  <p className="mt-1 text-muted-foreground">
                    Or from a terminal:{" "}
                    <code className="rounded bg-muted px-1">
                      claude mcp add --transport http mesh-multisig{" "}
                      {MCP_ENDPOINT}
                    </code>
                  </p>
                </div>
              </div>
            </li>

            <li className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  2
                </span>
                <span className="font-medium">
                  Approve it, and pick what it may do
                </span>
              </div>
              <p className="pl-7 text-muted-foreground">
                Your client sends you here to a consent screen: connect your
                wallet, sign, and approve. You see which client is asking and
                the exact address set it will cover.
              </p>
              <p className="pl-7 text-muted-foreground">
                The permissions requested by your client are listed there as
                separate checkboxes, ticked by default. Untick any you would
                rather not grant — the tools it covers then simply do not exist
                for that client.
              </p>
            </li>

            {/* Added because there was no way to tell a successful connect
                      from a half-scoped one: both look like a working server, and
                      the only visible difference is how many tools appear. */}
            <li className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  3
                </span>
                <span className="font-medium">Check what you got</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                Your client&apos;s tool list should show{" "}
                <strong className="text-foreground">
                  {MCP_TOOL_SUMMARIES.length} tools
                </strong>{" "}
                if you granted everything. Fewer means fewer permissions, not a
                broken connection — the counts are{" "}
                {MCP_SCOPES.map(
                  (scope) =>
                    `${MCP_TOOL_SUMMARIES.filter((t) => t.scope === scope).length} for ${scope}`,
                ).join(", ")}
                .
              </p>
            </li>

            <li className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  4
                </span>
                <span className="font-medium">Ask it something</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                &ldquo;List the pending transactions on our treasury&rdquo; ·
                &ldquo;What can we actually spend right now?&rdquo; ·
                &ldquo;Which active governance proposals still need a
                decision?&rdquo;
              </p>
            </li>
          </ol>

          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">What it can do</h4>
            <p className="text-xs text-muted-foreground">
              {MCP_TOOL_SUMMARIES.length} tools, grouped by the permission they
              need. You choose which permissions to grant, and can change them
              later. Nothing here signs or broadcasts: an agent can draft an
              unsigned transaction and show you a review card, but every
              signature is still yours to add in the app.
            </p>
            <div className="mt-1 flex flex-col gap-3">
              {MCP_SCOPES.map((scope) => (
                <div key={scope}>
                  <code className="text-xs font-medium text-foreground">
                    {scope}
                  </code>
                  <ul className="mt-1 flex flex-col gap-1">
                    {MCP_TOOL_SUMMARIES.filter((t) => t.scope === scope).map(
                      (t) => (
                        <li
                          key={t.name}
                          className="text-xs text-muted-foreground"
                        >
                          <code className="rounded bg-muted px-1">
                            {t.name}
                          </code>{" "}
                          — {t.blurb}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* The asymmetry here is not obvious and is easy to read as a
                    bug: an access token carries the scopes it was minted with,
                    and the server intersects them with the grant, so taking a
                    permission away bites at once while adding one cannot reach
                    a token already issued. */}
          <div className="rounded-lg border border-dashed p-3">
            <h4 className="text-sm font-medium">Changing permissions later</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Under{" "}
              <Link
                prefetch={false}
                href="/user"
                className="underline underline-offset-2"
              >
                your profile
              </Link>{" "}
              each connection lists its permissions.{" "}
              <strong className="text-foreground">
                Removing one takes effect on the client&apos;s very next
                request.
              </strong>{" "}
              Adding one does not: the client is holding a token issued with the
              old set, and refreshing its tool list just re-asks with that same
              token. Reconnect the connector to pick up a wider permission —
              refreshing a token cannot widen its original permissions.
            </p>
          </div>

          <div className="rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">
                Your signatures stay with you.
              </strong>{" "}
              A connected client can read your wallets and governance, draft
              ballots, manage tasks, publish rationales to IPFS, and prepare
              unsigned transaction drafts when you grant the corresponding
              permissions. It <strong>cannot</strong> sign transactions, move
              funds, or submit a vote on-chain — those stay with you and your
              co-signers, whichever permissions you grant.
            </p>
          </div>
        </div>
      </CardUI>
    </div>
  );
}
