import { useEffect, useMemo, useState } from "react";
import { Mail, Send, Save } from "lucide-react";

import CardUI from "@/components/ui/card-content";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import type { Wallet } from "@/types/wallet";

export function WalletNotificationSettings({
  appWallet,
}: {
  appWallet: Wallet;
}) {
  const userAddress = useUserStore((state) => state.userAddress);
  const isSigner = useMemo(
    () =>
      Boolean(
        userAddress && appWallet.signersAddresses.includes(userAddress),
      ),
    [appWallet.signersAddresses, userAddress],
  );
  const { toast } = useToast();
  const utils = api.useUtils();
  const { data: setting, isLoading } =
    api.notification.getWalletSignerSetting.useQuery(
      { walletId: appWallet.id },
      { enabled: isSigner },
    );

  const [email, setEmail] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [notifyTransactions, setNotifyTransactions] = useState(true);
  const [notifySignables, setNotifySignables] = useState(true);

  useEffect(() => {
    if (!setting) return;
    setEmail(setting.email ?? "");
    setEmailOptIn(setting.emailOptIn);
    setNotifyTransactions(setting.notifyTransactionSignatures);
    setNotifySignables(setting.notifySignableSignatures);
  }, [setting]);

  const invalidate = async () => {
    await utils.notification.getWalletSignerSetting.invalidate({
      walletId: appWallet.id,
    });
  };

  const { mutate: saveSetting, isPending: saving } =
    api.notification.upsertWalletSignerSetting.useMutation({
      onSuccess: async () => {
        await invalidate();
        toast({
          title: "Notification settings saved",
          description: "Your wallet email preferences have been updated.",
          duration: 4000,
        });
      },
      onError: (error) => {
        toast({
          title: "Unable to save notification settings",
          description: error.message,
          variant: "destructive",
          duration: 6000,
        });
      },
    });

  const { mutate: sendVerification, isPending: sendingVerification } =
    api.notification.sendVerificationEmail.useMutation({
      onSuccess: async (result) => {
        await invalidate();
        toast({
          title: result.emailEnabled
            ? "Verification email queued"
            : "Verification email prepared",
          description: result.emailEnabled
            ? "Check your inbox for the verification link."
            : "Email delivery is disabled in this environment.",
          duration: 5000,
        });
      },
      onError: (error) => {
        toast({
          title: "Unable to send verification email",
          description: error.message,
          variant: "destructive",
          duration: 6000,
        });
      },
    });

  if (!isSigner) {
    return null;
  }

  const verified = Boolean(setting?.emailVerifiedAt);
  const emailChanged = email.trim() !== (setting?.email ?? "");
  const canSendVerification = Boolean(setting?.email) && !emailChanged;

  const persist = (overrides: Partial<{
    email: string;
    emailOptIn: boolean;
    notifyTransactionSignatures: boolean;
    notifySignableSignatures: boolean;
  }> = {}) => {
    saveSetting({
      walletId: appWallet.id,
      email,
      emailOptIn,
      notifyTransactionSignatures: notifyTransactions,
      notifySignableSignatures: notifySignables,
      ...overrides,
    });
  };

  return (
    <CardUI
      title="Email Notifications"
      description="Manage email alerts for signatures needed from your signer address on this wallet."
      icon={Mail}
      cardClassName="col-span-2"
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={verified ? "default" : "secondary"}>
            {verified ? "Verified" : "Not verified"}
          </Badge>
          {setting?.email && (
            <span className="text-sm text-muted-foreground">
              {setting.email}
            </span>
          )}
        </div>

        {!verified && setting?.email && !emailChanged && (
          <Alert>
            <AlertDescription>
              Verify this email before signature-required notifications can be sent.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="wallet-notification-email">Email address</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="wallet-notification-email"
              type="email"
              value={email}
              disabled={isLoading || saving}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
            <Button
              type="button"
              disabled={saving}
              onClick={() => persist()}
              className="shrink-0"
            >
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Email notifications</p>
              <p className="text-xs text-muted-foreground">
                Master opt-in for this wallet and signer address.
              </p>
            </div>
            <Switch
              checked={emailOptIn}
              disabled={saving}
              onCheckedChange={(checked) => {
                setEmailOptIn(checked);
                persist({ emailOptIn: checked });
              }}
              aria-label="Toggle email notifications"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Transaction signatures</p>
              <p className="text-xs text-muted-foreground">
                Email me when a pending transaction needs my signature.
              </p>
            </div>
            <Switch
              checked={notifyTransactions}
              disabled={saving}
              onCheckedChange={(checked) => {
                setNotifyTransactions(checked);
                persist({ notifyTransactionSignatures: checked });
              }}
              aria-label="Toggle transaction signature notifications"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Signable payloads</p>
              <p className="text-xs text-muted-foreground">
                Email me when a datum or payload needs my signature.
              </p>
            </div>
            <Switch
              checked={notifySignables}
              disabled={saving}
              onCheckedChange={(checked) => {
                setNotifySignables(checked);
                persist({ notifySignableSignatures: checked });
              }}
              aria-label="Toggle signable payload notifications"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={!canSendVerification || sendingVerification}
          onClick={() => sendVerification({ walletId: appWallet.id })}
        >
          <Send className="mr-2 h-4 w-4" />
          {sendingVerification ? "Sending..." : "Send verification email"}
        </Button>
      </div>
    </CardUI>
  );
}
