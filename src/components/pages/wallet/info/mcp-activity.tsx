import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plug } from "lucide-react";

import CardUI from "@/components/ui/card-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import type { Wallet } from "@/types/wallet";

/**
 * AI clients that have used this wallet, and what they actually did.
 *
 * The profile card answers "what have I connected"; this answers "what has
 * touched *this* wallet", which is the question a co-signer asks. It reads the
 * audit trail rather than the grants — a grant says what a client *may* do,
 * these rows say what it did.
 */
export default function McpActivityCard({ appWallet }: { appWallet: Wallet }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: clients, isLoading } = api.mcp.walletClients.useQuery(
    { walletId: appWallet.id },
    { enabled: Boolean(appWallet.id) },
  );

  const { data: usage, isLoading: usageLoading } = api.mcp.walletToolUsage.useQuery(
    { walletId: appWallet.id, client: expanded ?? undefined, limit: 50 },
    { enabled: expanded !== null },
  );

  return (
    <CardUI
      title="AI client activity"
      description="Tool calls made against this wallet over the Model Context Protocol."
      icon={Plug}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
        </div>
      ) : !clients || clients.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No AI client has used this wallet yet. Connections are approved per
          user; anything that reads this wallet will be listed here.
        </p>
      ) : (
        <div className="flex flex-col gap-2 py-2">
          {clients.map((c) => {
            const open = expanded === c.client;
            return (
              <div key={c.client} className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-muted/50"
                  onClick={() => setExpanded(open ? null : c.client)}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <span className="break-all font-medium">{c.client}</span>
                      {c.failures > 0 && (
                        <Badge variant="destructive">{c.failures} failed</Badge>
                      )}
                    </div>
                    <span className="pl-6 text-xs text-muted-foreground">
                      {c.calls} call{c.calls === 1 ? "" : "s"} ·{" "}
                      {c.tools.length} tool{c.tools.length === 1 ? "" : "s"} ·
                      last {new Date(c.lastUsedAt).toLocaleString()}
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="border-t px-3 py-2">
                    {usageLoading ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading calls…
                      </div>
                    ) : !usage || usage.length === 0 ? (
                      <p className="py-2 text-xs text-muted-foreground">
                        No calls recorded.
                      </p>
                    ) : (
                      <ul className="flex flex-col divide-y">
                        {usage.map((row) => (
                          <li
                            key={row.id}
                            className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-xs"
                          >
                            <span className="flex items-center gap-2">
                              <code className="font-mono">{row.tool}</code>
                              {!row.readOnly && (
                                <Badge variant="secondary">write</Badge>
                              )}
                              {row.outcome !== "success" && (
                                <Badge variant="destructive">{row.outcome}</Badge>
                              )}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(row.at).toLocaleString()}
                              {row.durationMs !== null && ` · ${row.durationMs}ms`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <p className="pt-1 text-xs text-muted-foreground">
            Manage or revoke these connections from{" "}
            <a href="/user" className="underline underline-offset-2">
              your profile
            </a>
            .
          </p>
        </div>
      )}
    </CardUI>
  );
}
