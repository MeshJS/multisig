"use client";

import { useState } from "react";
import { Bot, Plus, Trash2, Copy, Loader2 } from "lucide-react";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/ui/row-label-info";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { getFirstAndLast } from "@/utils/strings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BOT_SCOPES } from "@/lib/auth/botKey";

export default function BotManagementCard() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdBotKeyId, setCreatedBotKeyId] = useState<string | null>(null);

  const { data: botKeys, isLoading } = api.bot.listBotKeys.useQuery({});
  const utils = api.useUtils();
  const createBotKey = api.bot.createBotKey.useMutation({
    onSuccess: (data) => {
      setCreatedSecret(data.secret);
      setCreatedBotKeyId(data.botKeyId);
      void utils.bot.listBotKeys.invalidate();
      toast({
        title: "Bot created",
        description: "Copy the secret now; it will not be shown again.",
        duration: 5000,
      });
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const revokeBotKey = api.bot.revokeBotKey.useMutation({
    onSuccess: () => {
      toast({ title: "Bot revoked" });
      void api.useUtils().bot.listBotKeys.invalidate();
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied",
        description: `${label} copied to clipboard`,
        duration: 3000,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to copy",
        variant: "destructive",
      });
    }
  };

  const handleCreate = () => {
    if (!newName.trim() || newScopes.length === 0) {
      toast({
        title: "Invalid input",
        description: "Name and at least one scope required",
        variant: "destructive",
      });
      return;
    }
    createBotKey.mutate({ name: newName.trim(), scope: newScopes as ("multisig:create" | "multisig:read" | "multisig:sign")[] });
  };

  const handleCloseCreate = () => {
    setCreateOpen(false);
    setNewName("");
    setNewScopes([]);
    setCreatedSecret(null);
    setCreatedBotKeyId(null);
  };

  const toggleScope = (scope: string) => {
    setNewScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  return (
    <CardUI
      title="Bot accounts"
      description="Create and manage bots for API access"
      icon={Bot}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Bots</span>
          <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) handleCloseCreate(); }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                Create bot
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create bot</DialogTitle>
                <DialogDescription>
                  Create a bot key. The secret is shown only once; store it securely.
                </DialogDescription>
              </DialogHeader>
              {createdSecret && createdBotKeyId ? (
                <div className="space-y-3">
                  <p className="text-sm text-amber-600 font-medium">Copy the JSON blob now. The secret will not be shown again.</p>
                  <p className="text-xs text-muted-foreground">
                    Pass this to your bot (or save as <code className="rounded bg-muted px-1">bot-config.json</code>). Set <code className="rounded bg-muted px-1">paymentAddress</code> to the bot&apos;s Cardano address before calling POST /api/v1/botAuth.
                  </p>
                  <pre className="rounded border bg-muted p-3 text-xs font-mono overflow-x-auto max-h-28 overflow-y-auto break-all whitespace-pre-wrap">
                    {JSON.stringify(
                      { botKeyId: createdBotKeyId, secret: createdSecret, paymentAddress: "" },
                      null,
                      2,
                    )}
                  </pre>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() =>
                      handleCopy(
                        JSON.stringify({
                          botKeyId: createdBotKeyId,
                          secret: createdSecret,
                          paymentAddress: "",
                        }),
                        "Bot config JSON",
                      )
                    }
                  >
                    <Copy className="h-4 w-4" />
                    Copy JSON blob
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Then use POST /api/v1/botAuth with this JSON (with paymentAddress set). The bot can also sign in via getNonce + authSigner using that wallet. See <code className="rounded bg-muted px-1">scripts/bot-ref/</code> for a reference client.
                  </p>
                  <DialogFooter>
                    <Button onClick={handleCloseCreate}>Done</Button>
                  </DialogFooter>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="bot-name">Name</Label>
                    <Input
                      id="bot-name"
                      placeholder="My bot"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Scopes</Label>
                    <div className="flex flex-col gap-2">
                      {BOT_SCOPES.map((scope) => (
                        <div key={scope} className="flex items-center space-x-2">
                          <Checkbox
                            id={scope}
                            checked={newScopes.includes(scope)}
                            onCheckedChange={() => toggleScope(scope)}
                          />
                          <label htmlFor={scope} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {scope}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleCreate}
                      disabled={createBotKey.isPending || !newName.trim() || newScopes.length === 0}
                    >
                      {createBotKey.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading bots…
          </div>
        ) : !botKeys?.length ? (
          <p className="text-sm text-muted-foreground">No bots yet. Create one to allow API access with a bot key or wallet sign-in.</p>
        ) : (
          <ul className="space-y-3 max-h-[280px] overflow-y-auto">
            {botKeys.map((key) => (
              <li
                key={key.id}
                className="flex flex-col gap-1 rounded-md border p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{key.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm("Revoke this bot? The bot will no longer be able to authenticate.")) {
                        revokeBotKey.mutate({ botKeyId: key.id });
                      }
                    }}
                    disabled={revokeBotKey.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <RowLabelInfo
                  label="Key ID"
                  value={getFirstAndLast(key.id, 10, 8)}
                  copyString={key.id}
                />
                {key.botUser ? (
                  <>
                    <RowLabelInfo
                      label="Bot address"
                      value={getFirstAndLast(key.botUser.paymentAddress, 12, 8)}
                      copyString={key.botUser.paymentAddress}
                    />
                    {key.botUser.displayName && (
                      <RowLabelInfo label="Display name" value={key.botUser.displayName} />
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Not registered yet. Use botAuth with this key to register the bot wallet.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Created {new Date(key.createdAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CardUI>
  );
}
