import { useEffect, useMemo, useState } from "react";
import { useAddress } from "@meshsdk/react";
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
import { normalizeAddressToBech32 } from "@/utils/addressCompatibility";
import type { Wallet } from "@/types/wallet";

function addressesEqual(a: string, b: string): boolean {
  return normalizeAddressToBech32(a) === normalizeAddressToBech32(b);
}

export function WalletNotificationSettings({
  appWallet,
}: {
  appWallet: Wallet;
}) {
  const rawAddress = useAddress();
  const storeAddress = useUserStore((state) => state.userAddress);
  const connectedAddress = useMemo(() => {
    const hookAddress = rawAddress ? normalizeAddressToBech32(rawAddress) : "";
    const persistedAddress = storeAddress
      ? normalizeAddressToBech32(storeAddress)
      : "";
    return hookAddress || persistedAddress;
  }, [rawAddress, storeAddress]);
  const signerScope = connectedAddress
    ? `${appWallet.id}:${connectedAddress}`
    : "";

  const isSigner = useMemo(
    () =>
      Boolean(
        connectedAddress &&
          appWallet.signersAddresses.some((address) =>
            addressesEqual(address, connectedAddress),
          ),
      ),
    [appWallet.signersAddresses, connectedAddress],
  );

  const { data: walletSession } = api.auth.getWalletSession.useQuery(
    { address: connectedAddress },
    { enabled: connectedAddress.length > 0, refetchOnWindowFocus: false },
  );
  const isSessionAuthorized = useMemo(
    () =>
      (walletSession?.wallets ?? []).some((wallet) =>
        addressesEqual(wallet, connectedAddress),
      ),
    [walletSession?.wallets, connectedAddress],
  );

  const { toast } = useToast();
  const utils = api.useUtils();
  const {
    data: setting,
    isLoading,
    isFetching,
    isSuccess,
    isError,
    fetchStatus,
  } = api.notification.getWalletSignerSetting.useQuery(
    { walletId: appWallet.id, signerAddress: connectedAddress },
    {
      enabled: isSigner && connectedAddress.length > 0,
      staleTime: 0,
      refetchOnMount: "always",
      retry: (failureCount, error) => {
        if (
          error &&
          typeof error === "object" &&
          ("data" in error
            ? (error as { data?: { httpStatus?: number } }).data?.httpStatus ===
              403
            : false)
        ) {
          return false;
        }
        return failureCount < 1;
      },
    },
  );

  const settingMatchesConnectedSigner =
    Boolean(setting) &&
    connectedAddress.length > 0 &&
    addressesEqual(setting!.signerAddress, connectedAddress);

  const isSettingResolved =
    isSuccess &&
    fetchStatus === "idle" &&
    !isFetching &&
    settingMatchesConnectedSigner;

  const [email, setEmail] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [notifyTransactions, setNotifyTransactions] = useState(true);
  const [notifySignables, setNotifySignables] = useState(true);
  const [appliedScope, setAppliedScope] = useState<string | null>(null);

  useEffect(() => {
    setAppliedScope(null);
    setEmail("");
    setEmailOptIn(true);
    setNotifyTransactions(true);
    setNotifySignables(true);
    void utils.notification.getWalletSignerSetting.cancel();
    void utils.notification.getWalletSignerSetting.reset();
  }, [signerScope, utils.notification.getWalletSignerSetting]);

  useEffect(() => {
    if (!isSettingResolved || !setting || !signerScope) return;
    setAppliedScope(signerScope);
    setEmail(setting.email ?? "");
    setEmailOptIn(setting.emailOptIn);
    setNotifyTransactions(setting.notifyTransactionSignatures);
    setNotifySignables(setting.notifySignableSignatures);
  }, [isSettingResolved, setting, signerScope]);

  const canShowSavedSettings = appliedScope === signerScope && isSettingResolved;

  const invalidate = async () => {
    if (!connectedAddress) return;
    await utils.notification.getWalletSignerSetting.invalidate({
      walletId: appWallet.id,
      signerAddress: connectedAddress,
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

  const needsAuthorization =
    !isSessionAuthorized || (isError && !isSettingResolved);
  const isResolvingSettings =
    connectedAddress.length > 0 &&
    (isLoading || isFetching || !canShowSavedSettings);

  if (needsAuthorization && !isResolvingSettings) {
    return (
      <CardUI
        title="Email Notifications"
        description="Manage email alerts for signatures needed from your signer address on this wallet."
        icon={Mail}
        cardClassName="col-span-2"
      >
        <Alert>
          <AlertDescription>
            Authorize your connected wallet before managing notification settings.
          </AlertDescription>
        </Alert>
      </CardUI>
    );
  }

  const verified = canShowSavedSettings
    ? Boolean(setting?.emailVerifiedAt)
    : false;
  const savedEmail = canShowSavedSettings ? (setting?.email ?? "") : "";
  const emailChanged = email.trim() !== savedEmail;
  const canSendVerification = Boolean(savedEmail) && !emailChanged;
  const inputEmail = canShowSavedSettings ? email : "";

  const persist = (overrides: Partial<{
    email: string;
    emailOptIn: boolean;
    notifyTransactionSignatures: boolean;
    notifySignableSignatures: boolean;
  }> = {}) => {
    if (!connectedAddress || !canShowSavedSettings) return;
    saveSetting({
      walletId: appWallet.id,
      signerAddress: connectedAddress,
      email: inputEmail,
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
            {isResolvingSettings
              ? "Loading"
              : verified
                ? "Verified"
                : savedEmail
                  ? "Not verified"
                  : "No email"}
          </Badge>
          {canShowSavedSettings && savedEmail && (
            <span className="text-sm text-muted-foreground">{savedEmail}</span>
          )}
        </div>

        {!verified && savedEmail && !emailChanged && canShowSavedSettings && (
          <Alert>
            <AlertDescription>
              Verify this email before signature-required notifications can be sent.
            </AlertDescription>
          </Alert>
        )}

        {canShowSavedSettings && !savedEmail && (
          <Alert>
            <AlertDescription>
              Add your email address below to receive alerts when this wallet needs your signature.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="wallet-notification-email">Email address</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="wallet-notification-email"
              type="email"
              value={inputEmail}
              disabled={isResolvingSettings || saving}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
            <Button
              type="button"
              disabled={isResolvingSettings || saving || !canShowSavedSettings}
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
              disabled={isResolvingSettings || saving || !canShowSavedSettings}
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
              disabled={isResolvingSettings || saving || !canShowSavedSettings}
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
              disabled={isResolvingSettings || saving || !canShowSavedSettings}
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
          disabled={
            !canShowSavedSettings ||
            !canSendVerification ||
            sendingVerification
          }
          onClick={() =>
            sendVerification({
              walletId: appWallet.id,
              signerAddress: connectedAddress,
            })
          }
        >
          <Send className="mr-2 h-4 w-4" />
          {sendingVerification ? "Sending..." : "Send verification email"}
        </Button>
      </div>
    </CardUI>
  );
}
