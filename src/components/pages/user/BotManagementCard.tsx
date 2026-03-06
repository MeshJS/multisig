"use client";

import { useState } from "react";
import { Bot, Trash2, Loader2, Pencil, Link } from "lucide-react";
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
import useUserWallets from "@/hooks/useUserWallets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const READ_SCOPE = "multisig:read" as const;

export default function BotManagementCard() {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editingBotKeyId, setEditingBotKeyId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState<BotScope[]>([]);

  // Claim dialog state
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimStep, setClaimStep] = useState<"enterCode" | "review" | "success">("enterCode");
  const [pendingBotId, setPendingBotId] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [pendingBotInfo, setPendingBotInfo] = useState<{
    name: string;
    paymentAddress: string;
    requestedScopes: string[];
  } | null>(null);
  const [approvedScopes, setApprovedScopes] = useState<BotScope[]>([]);
  const [claimResult, setClaimResult] = useState<{
    botKeyId: string;
    botId: string;
    name: string;
    scopes: BotScope[];
  } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedWalletByBot, setSelectedWalletByBot] = useState<Record<string, string>>({});

  const { data: botKeys, isLoading } = api.bot.listBotKeys.useQuery({});
  const { wallets: userWallets, isLoading: isLoadingWallets } = useUserWallets();
  const editingBotKey = botKeys?.find((key) => key.id === editingBotKeyId) ?? null;
  const utils = api.useUtils();

  const handleCloseEdit = () => {
    setEditOpen(false);
    setEditingBotKeyId(null);
    setEditScopes([]);
  };

  const handleCloseClaim = () => {
    setClaimOpen(false);
    setClaimStep("enterCode");
    setPendingBotId("");
    setClaimCode("");
    setPendingBotInfo(null);
    setApprovedScopes([]);
    setClaimResult(null);
    setLookupError(null);
  };

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

  const claimBot = api.bot.claimBot.useMutation({
    onSuccess: (data) => {
      setClaimResult(data);
      setClaimStep("success");
      void utils.bot.listBotKeys.invalidate();
      toast({
        title: "Bot claimed",
        description: `${data.name} is now linked to your account.`,
      });
    },
    onError: (err) => {
      const messages: Record<string, string> = {
        bot_not_found: "Bot not found or registration expired.",
        bot_already_claimed: "This bot has already been claimed.",
        invalid_or_expired_claim_code: "Invalid or expired claim code.",
        claim_locked_out: "Too many failed attempts. Ask the bot to re-register.",
      };
      toast({
        title: "Claim failed",
        description: messages[err.message] ?? err.message,
        variant: "destructive",
      });
    },
  });

  const grantBotAccess = api.bot.grantBotAccess.useMutation({
    onSuccess: () => {
      toast({ title: "Wallet access granted", description: "Bot is now an observer on the selected multisig." });
    },
    onError: (err) => {
      toast({
        title: "Grant failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const revokeBotAccess = api.bot.revokeBotAccess.useMutation({
    onSuccess: () => {
      toast({ title: "Wallet access revoked" });
    },
    onError: (err) => {
      toast({
        title: "Revoke failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleLookupAndAdvance = async () => {
    setLookupError(null);
    try {
      const info = await utils.bot.lookupPendingBot.fetch({ pendingBotId: pendingBotId.trim() });
      if (info.status !== "UNCLAIMED") {
        setLookupError("This bot has already been claimed.");
        return;
      }
      setPendingBotInfo(info);
      const validScopes = info.requestedScopes.filter(
        (s): s is BotScope => BOT_SCOPES.includes(s as BotScope),
      );
      setApprovedScopes(validScopes);
      setClaimStep("review");
    } catch {
      setLookupError("Bot not found or registration expired.");
    }
  };

  const toggleClaimScope = (scope: BotScope) => {
    setApprovedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const missingReadScopeInClaim = approvedScopes.length > 0 && !approvedScopes.includes(READ_SCOPE);

  const openEditDialog = (botKeyId: string, scopes: readonly BotScope[]) => {
    setEditingBotKeyId(botKeyId);
    setEditScopes([...scopes]);
    setEditOpen(true);
  };

  const handleSaveScopes = () => {
    if (!editingBotKeyId || editScopes.length === 0) return;
    updateBotKeyScopes.mutate({ botKeyId: editingBotKeyId, scope: editScopes });
  };

  const toggleEditScope = (scope: BotScope) => {
    setEditScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const missingReadScopeInEdit = editScopes.length > 0 && !editScopes.includes(READ_SCOPE);

  return (
    <CardUI
      title="Bot accounts"
      description="Claim and manage bots for API access"
      icon={Bot}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Bots</span>
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={() => setClaimOpen(true)}
          >
            <Link className="h-4 w-4" />
            Claim a bot
          </Button>
        </div>
        <Dialog
          open={claimOpen}
          onOpenChange={(open) => {
            if (!open) handleCloseClaim();
          }}
        >
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            {claimStep === "enterCode" && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Link className="h-4 w-4" />
                    Claim a bot
                  </DialogTitle>
                  <DialogDescription>
                    Enter the bot ID and claim code from your bot&apos;s output.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="claim-bot-id">Bot ID</Label>
                    <Input
                      id="claim-bot-id"
                      placeholder="clxyz..."
                      value={pendingBotId}
                      onChange={(e) => setPendingBotId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="claim-code">Claim code</Label>
                    <Input
                      id="claim-code"
                      placeholder="Paste from bot output"
                      value={claimCode}
                      onChange={(e) => setClaimCode(e.target.value)}
                    />
                  </div>
                  {lookupError && (
                    <p className="text-xs text-destructive">{lookupError}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={handleCloseClaim}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleLookupAndAdvance}
                    disabled={!pendingBotId.trim() || !claimCode.trim()}
                  >
                    Next
                  </Button>
                </DialogFooter>
              </>
            )}

            {claimStep === "review" && pendingBotInfo && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Link className="h-4 w-4" />
                    Claim a bot
                  </DialogTitle>
                  <DialogDescription>
                    Review the bot&apos;s details and approve its requested permissions.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <RowLabelInfo label="Bot name" value={pendingBotInfo.name} />
                    <RowLabelInfo
                      label="Address"
                      value={getFirstAndLast(pendingBotInfo.paymentAddress, 12, 8)}
                      copyString={pendingBotInfo.paymentAddress}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Requested scopes</Label>
                    <div className="flex flex-col gap-2">
                      {BOT_SCOPES.map((scope) => {
                        const requested = pendingBotInfo.requestedScopes.includes(scope);
                        return (
                          <div key={scope} className="flex items-center space-x-2">
                            <Checkbox
                              id={`claim-scope-${scope}`}
                              checked={approvedScopes.includes(scope)}
                              onCheckedChange={() => toggleClaimScope(scope)}
                              disabled={!requested}
                            />
                            <label
                              htmlFor={`claim-scope-${scope}`}
                              className={`text-sm font-medium leading-none ${!requested ? "text-muted-foreground opacity-50" : ""}`}
                            >
                              {scope}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    {missingReadScopeInClaim && (
                      <p className="text-xs text-amber-600">
                        Warning: without <code className="rounded bg-muted px-1">multisig:read</code>, <code className="rounded bg-muted px-1">POST /api/v1/botAuth</code> authentication will fail for this bot key.
                      </p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setClaimStep("enterCode")}>
                    Back
                  </Button>
                  <Button
                    onClick={() =>
                      claimBot.mutate({
                        pendingBotId: pendingBotId.trim(),
                        claimCode: claimCode.trim(),
                        approvedScopes,
                      })
                    }
                    disabled={claimBot.isPending || approvedScopes.length === 0}
                  >
                    {claimBot.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Claim bot"}
                  </Button>
                </DialogFooter>
              </>
            )}

            {claimStep === "success" && claimResult && (
              <>
                <DialogHeader>
                  <DialogTitle>Bot claimed successfully</DialogTitle>
                  <DialogDescription>
                    &ldquo;{claimResult.name}&rdquo; is now linked to your account. The bot will automatically pick up its credentials.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-1">
                  <RowLabelInfo
                    label="Bot ID"
                    value={getFirstAndLast(claimResult.botId, 10, 8)}
                    copyString={claimResult.botId}
                  />
                  <RowLabelInfo
                    label="Key ID"
                    value={getFirstAndLast(claimResult.botKeyId, 10, 8)}
                    copyString={claimResult.botKeyId}
                  />
                  <div className="flex items-start gap-2">
                    <span className="min-w-20 text-sm font-medium text-muted-foreground">Scopes</span>
                    <div className="flex flex-wrap gap-1">
                      {claimResult.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCloseClaim}>Done</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
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
          <p className="text-sm text-muted-foreground">No bots yet. Register a bot and claim it to enable API access.</p>
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
                    (() => {
                      const botUser = key.botUser;
                      return (
                    <>
                      <RowLabelInfo
                        label="Bot address"
                        value={getFirstAndLast(botUser.paymentAddress, 12, 8)}
                        copyString={botUser.paymentAddress}
                      />
                      {botUser.displayName && (
                        <RowLabelInfo label="Display name" value={botUser.displayName} />
                      )}

                      <div className="mt-2 space-y-2 rounded-md border p-2">
                        <p className="text-xs font-medium text-muted-foreground">Wallet access</p>
                        {isLoadingWallets ? (
                          <p className="text-xs text-muted-foreground">Loading multisigs...</p>
                        ) : !userWallets?.length ? (
                          <p className="text-xs text-muted-foreground">No multisigs available for access grants.</p>
                        ) : (
                          <>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                              <Select
                                value={selectedWalletByBot[botUser.id] ?? userWallets[0]?.id ?? ""}
                                onValueChange={(value) =>
                                  setSelectedWalletByBot((prev) => ({ ...prev, [botUser.id]: value }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select multisig wallet" />
                                </SelectTrigger>
                                <SelectContent>
                                  {userWallets.map((wallet) => (
                                    <SelectItem key={wallet.id} value={wallet.id}>
                                      {wallet.name || getFirstAndLast(wallet.id, 8, 6)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const walletId = selectedWalletByBot[botUser.id] ?? userWallets[0]?.id;
                                  if (!walletId) return;
                                  grantBotAccess.mutate({
                                    walletId,
                                    botId: botUser.id,
                                    role: "observer",
                                  });
                                }}
                                disabled={grantBotAccess.isPending}
                              >
                                {grantBotAccess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant observer"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const walletId = selectedWalletByBot[botUser.id] ?? userWallets[0]?.id;
                                  if (!walletId) return;
                                  revokeBotAccess.mutate({
                                    walletId,
                                    botId: botUser.id,
                                  });
                                }}
                                disabled={revokeBotAccess.isPending}
                              >
                                {revokeBotAccess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke"}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Grants read-only wallet access for this bot on the selected multisig.
                            </p>
                          </>
                        )}
                      </div>
                    </>
                      );
                    })()
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
