import { useState } from "react";
import { Loader2, Plug, ShieldCheck, Trash2 } from "lucide-react";

import CardUI from "@/components/ui/card-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { MCP_SCOPES, MCP_SCOPE_DESCRIPTIONS, type McpScope } from "@/lib/mcp/scopes";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";

/**
 * AI clients connected over MCP.
 *
 * The counterpart to BotManagementCard: bots authenticate with a key the user
 * mints here, MCP clients authenticate with an OAuth grant the user approves on
 * the consent screen. Both need to be visible and revocable in one place, or a
 * user has no way to see what they have connected.
 */
export default function McpConnectionsCard() {
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);
  const [pendingRevoke, setPendingRevoke] = useState<{
    clientId: string;
    clientName: string;
  } | null>(null);
  /** Per-connection scope edits, keyed by clientId, until saved. */
  const [drafts, setDrafts] = useState<Record<string, McpScope[]>>({});

  const utils = api.useUtils();
  const { data: connections, isLoading } = api.mcp.listConnections.useQuery(
    { requesterAddress: userAddress ?? "" },
    { enabled: Boolean(userAddress) },
  );

  const updateScopes = api.mcp.updateConnectionScopes.useMutation({
    onSuccess: (_r, vars) => {
      void utils.mcp.listConnections.invalidate();
      setDrafts((d) => {
        const next = { ...d };
        delete next[vars.clientId];
        return next;
      });
      // Both halves, always: the old copy said only "next request", which is
      // true of a removal and false of an addition — the client keeps using the
      // token it already holds, so a newly granted permission looks broken.
      toast({
        title: "Permissions updated",
        description:
          "Removals apply on the next request. An added permission needs the client to reconnect, or up to an hour for its token to refresh.",
      });
    },
    onError: (error) =>
      toast({ title: "Could not update", description: error.message, variant: "destructive" }),
  });

  const revoke = api.mcp.revokeConnection.useMutation({
    onSuccess: (result) => {
      void utils.mcp.listConnections.invalidate();
      setPendingRevoke(null);
      toast({
        title: "Connection revoked",
        description:
          result.refreshTokensRevoked > 0
            ? `${result.refreshTokensRevoked} session${result.refreshTokensRevoked === 1 ? "" : "s"} ended. Any access token already issued stops working within the hour.`
            : "The client will need your approval again to reconnect.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not revoke",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!userAddress) return null;

  return (
    <>
      <CardUI
        title="Connected AI clients"
        description="Applications you have approved over the Model Context Protocol. Revoking one ends its access."
        icon={Plug}
      >
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
          </div>
        ) : !connections || connections.length === 0 ? (
          <div className="flex flex-col gap-2 py-2">
            <p className="text-sm text-muted-foreground">
              No AI clients connected yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Point an MCP client at{" "}
              <code className="rounded bg-muted px-1">/api/mcp</code> and approve
              it when the consent screen appears. Connections are read-only apart
              from governance ballot drafts — they cannot sign transactions, move
              funds, or vote on-chain.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-2">
            {connections.map((c) => (
              <div
                key={c.clientId}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{c.clientName}</span>
                    {c.isMetadataUrl && (
                      <Badge variant="secondary" title="Identified by a Client ID Metadata Document">
                        verified metadata
                      </Badge>
                    )}
                    <Badge variant={c.activeSessions > 0 ? "default" : "outline"}>
                      {c.activeSessions > 0 ? "active" : "idle"}
                    </Badge>
                  </div>

                  {/* The name is chosen by the client; the id is what we verified. */}
                  <code className="block break-all text-xs text-muted-foreground">
                    {c.clientId}
                  </code>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-xs font-medium">Permissions</legend>
                    {MCP_SCOPES.map((scope) => {
                      const current = drafts[c.clientId] ?? (c.scopes as McpScope[]);
                      const checked = current.includes(scope);
                      return (
                        <label
                          key={scope}
                          className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={checked}
                            onCheckedChange={(v) =>
                              setDrafts((d) => {
                                const base = d[c.clientId] ?? (c.scopes as McpScope[]);
                                const next = v === true
                                  ? MCP_SCOPES.filter((s) => s === scope || base.includes(s))
                                  : base.filter((s) => s !== scope);
                                return { ...d, [c.clientId]: next };
                              })
                            }
                          />
                          <span>
                            <span className="font-mono text-foreground">{scope}</span>
                            {" — "}
                            {MCP_SCOPE_DESCRIPTIONS[scope]}
                          </span>
                        </label>
                      );
                    })}
                    {drafts[c.clientId] && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          disabled={updateScopes.isPending}
                          onClick={() =>
                            updateScopes.mutate({
                              clientId: c.clientId,
                              requesterAddress: userAddress,
                              scopes: drafts[c.clientId] ?? [],
                            })
                          }
                        >
                          {updateScopes.isPending ? "Saving…" : "Save permissions"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[c.clientId];
                              return next;
                            })
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </fieldset>

                  <p className="text-xs text-muted-foreground">
                    Approved {new Date(c.approvedAt).toLocaleDateString()}
                    {c.grantedAddresses.length > 1 &&
                      ` · covers ${c.grantedAddresses.length} wallets`}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    setPendingRevoke({ clientId: c.clientId, clientName: c.clientName })
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardUI>

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {pendingRevoke?.clientName}?</DialogTitle>
            <DialogDescription>
              It will lose access to your wallets and need your approval again to
              reconnect. An access token already issued keeps working until it
              expires, within the hour.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() =>
                pendingRevoke &&
                revoke.mutate({
                  clientId: pendingRevoke.clientId,
                  requesterAddress: userAddress,
                })
              }
            >
              {revoke.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Revoking…
                </>
              ) : (
                "Revoke access"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
