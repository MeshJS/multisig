"use client";

import { useState } from "react";
import { Bot, Plus, Trash2, Copy, Loader2, Pencil } from "lucide-react";
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
import { BOT_SCOPES, type BotScope } from "@/lib/auth/botKey";
import { Badge } from "@/components/ui/badge";

const READ_SCOPE = "multisig:read" as const;

export default function BotManagementCard() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<BotScope[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdBotKeyId, setCreatedBotKeyId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingBotKeyId, setEditingBotKeyId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState<BotScope[]>([]);

  const { data: botKeys, isLoading } = api.bot.listBotKeys.useQuery({});
  const editingBotKey = botKeys?.find((key) => key.id === editingBotKeyId) ?? null;
  const utils = api.useUtils();

  const handleCloseCreate = () => {
    setCreateOpen(false);
    setNewName("");
    setNewScopes([]);
    setCreatedSecret(null);
    setCreatedBotKeyId(null);
  };

  const handleCloseEdit = () => {
    setEditOpen(false);
    setEditingBotKeyId(null);
    setEditScopes([]);
  };

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
      void utils.bot.listBotKeys.invalidate();
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const updateBotKeyScopes = api.bot.updateBotKeyScopes.useMutation({
    onSuccess: () => {
      toast({ title: "Scopes updated" });
      handleCloseEdit();
      void utils.bot.listBotKeys.invalidate();
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
    createBotKey.mutate({ name: newName.trim(), scope: newScopes });
  };

  const openEditDialog = (botKeyId: string, scopes: readonly BotScope[]) => {
    setEditingBotKeyId(botKeyId);
    setEditScopes([...scopes]);
    setEditOpen(true);
  };

  const handleSaveScopes = () => {
    if (!editingBotKeyId || editScopes.length === 0) return;
    updateBotKeyScopes.mutate({ botKeyId: editingBotKeyId, scope: editScopes });
  };

  const toggleScope = (scope: BotScope) => {
    setNewScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const toggleEditScope = (scope: BotScope) => {
    setEditScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const missingReadScopeInCreate = newScopes.length > 0 && !newScopes.includes(READ_SCOPE);
  const missingReadScopeInEdit = editScopes.length > 0 && !editScopes.includes(READ_SCOPE);

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
                            id={`create-scope-${scope}`}
                            checked={newScopes.includes(scope)}
                            onCheckedChange={() => toggleScope(scope)}
                          />
                          <label htmlFor={`create-scope-${scope}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {scope}
                          </label>
                        </div>
                      ))}
                    </div>
                    {missingReadScopeInCreate && (
                      <p className="text-xs text-amber-600">
                        Warning: without <code className="rounded bg-muted px-1">multisig:read</code>, <code className="rounded bg-muted px-1">POST /api/v1/botAuth</code> authentication will fail for this bot key.
                      </p>
                    )}
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
        <Dialog
          open={editOpen}
          onOpenChange={(open) => {
            if (!open) handleCloseEdit();
          }}
        >
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-4 w-4" />
                Edit scopes
              </DialogTitle>
              <DialogDescription>
                Update API scopes for {editingBotKey?.name ?? "this bot"}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="flex flex-col gap-2">
                {BOT_SCOPES.map((scope) => (
                  <div key={scope} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-scope-${scope}`}
                      checked={editScopes.includes(scope)}
                      onCheckedChange={() => toggleEditScope(scope)}
                    />
                    <label htmlFor={`edit-scope-${scope}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                      {scope}
                    </label>
                  </div>
                ))}
              </div>
              {missingReadScopeInEdit && (
                <p className="text-xs text-amber-600">
                  Warning: without <code className="rounded bg-muted px-1">multisig:read</code>, <code className="rounded bg-muted px-1">POST /api/v1/botAuth</code> authentication will fail for this bot key.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseEdit}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveScopes}
                disabled={updateBotKeyScopes.isPending || !editingBotKeyId || editScopes.length === 0}
              >
                {updateBotKeyScopes.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading bots…
          </div>
        ) : !botKeys?.length ? (
          <p className="text-sm text-muted-foreground">No bots yet. Create one to allow API access with a bot key or wallet sign-in.</p>
        ) : (
          <ul className="space-y-3 max-h-[280px] overflow-y-auto">
            {botKeys.map((key) => {
              const scopes = key.scopes ?? [];
              return (
                <li
                  key={key.id}
                  className="flex flex-col gap-1 rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{key.name}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(key.id, scopes)}
                      >
                        Edit scopes
                      </Button>
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
                  </div>
                  <RowLabelInfo
                    label="Key ID"
                    value={getFirstAndLast(key.id, 10, 8)}
                    copyString={key.id}
                  />
                  <div className="flex items-start gap-2">
                    <span className="min-w-20 text-sm font-medium text-muted-foreground">Scopes</span>
                    {scopes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No valid scopes configured.</span>
                    )}
                  </div>
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
              );
            })}
          </ul>
        )}
      </div>
    </CardUI>
  );
}
