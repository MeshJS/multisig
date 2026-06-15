import { useRouter } from "next/router";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import useMeshWallet from "@/hooks/useMeshWallet";
import { useToast } from "@/hooks/use-toast";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/ui/row-label-info";
import { Button } from "@/components/ui/button";
import { Copy, User as UserIcon, Wallet, Shield, Key, MessageCircle, CheckCircle2, XCircle, Loader2, Clock, Palette } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Background, BACKGROUND_PRESETS } from "@/components/ui/background";
import { useAppearanceStore } from "@/lib/zustand/appearance";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import Loading from "@/components/common/overall-layout/loading";
import { getFirstAndLast } from "@/utils/strings";
import useActiveWallet from "@/hooks/useActiveWallet";
import useUTXOS from "@/hooks/useUTXOS";
import { Badge } from "@/components/ui/badge";
import BotManagementCard from "@/components/pages/user/BotManagementCard";

export const getServerSideProps = () => ({ props: {} });

export default function UserInfoPage() {
  const router = useRouter();
  const { user, isLoading } = useUser();
  const userAddress = useUserStore((state) => state.userAddress);
  const userAssets = useUserStore((state) => state.userAssets);
  const { wallet, connected } = useMeshWallet();
  const { wallet: utxosWallet, isEnabled: isUtxosEnabled, isLoading: isUtxosLoading, error: utxosError } = useUTXOS();
  const { walletType, isAnyWalletConnected, isWalletReady, activeWallet } = useActiveWallet();
  const { toast } = useToast();
  const { data: discordData } = api.user.getUserDiscordId.useQuery({
    address: userAddress ?? "",
  });

  // Appearance preferences (persisted per-device).
  const backgroundEnabled = useAppearanceStore((s) => s.backgroundEnabled);
  const setBackgroundEnabled = useAppearanceStore((s) => s.setBackgroundEnabled);
  const backgroundPreset = useAppearanceStore((s) => s.backgroundPreset);
  const setBackgroundPreset = useAppearanceStore((s) => s.setBackgroundPreset);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied",
        description: `${label} copied to clipboard`,
        duration: 3000,
      });
    } catch (error) {
      console.error("Failed to copy:", error);
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  const getWalletAddress = async () => {
    if (!wallet) return userAddress;
    try {
      const usedAddresses = await wallet.getUsedAddresses();
      return usedAddresses[0] || userAddress;
    } catch (error) {
      return userAddress;
    }
  };

  if (isLoading) {
    return <Loading />;
  }

  if (!user) {
    return (
      <main className="flex w-full flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <UserIcon className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-2xl font-semibold">No User Found</h2>
          <p className="text-muted-foreground">
            Please connect your wallet to view your profile.
          </p>
          <Button onClick={() => router.push("/")}>Go Home</Button>
        </div>
      </main>
    );
  }

  const getWalletModeBadge = () => {
    if (isUtxosLoading) {
      return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Connecting...</Badge>;
    }
    // Check if UTXOS wallet is enabled - prioritize this check
    // isEnabled is true when wallet !== null, so if wallet exists, it's enabled
    if (utxosWallet) {
      if (utxosWallet.cardano) {
        return <Badge variant="default" className="bg-blue-600">UTXOS Mode</Badge>;
      } else {
        return <Badge variant="outline" className="bg-yellow-600">UTXOS (Initializing...)</Badge>;
      }
    }
    // Also check isEnabled flag as fallback
    if (isUtxosEnabled) {
      return <Badge variant="outline" className="bg-yellow-600">UTXOS (Initializing...)</Badge>;
    }
    // Check walletType as additional fallback
    if (walletType === "utxos") {
      return <Badge variant="default" className="bg-blue-600">UTXOS Mode</Badge>;
    }
    if (walletType === "regular") {
      return <Badge variant="default" className="bg-green-600">Regular Wallet</Badge>;
    }
    // If userAddress exists but no wallet type detected, likely UTXOS is initializing
    if (userAddress && !walletType && !connected) {
      return <Badge variant="outline" className="bg-yellow-600">Initializing...</Badge>;
    }
    return <Badge variant="secondary">Not Connected</Badge>;
  };

  const getConnectionStatus = () => {
    if (isUtxosLoading) {
      return { icon: Loader2, text: "Connecting...", className: "text-muted-foreground animate-spin" };
    }
    if (isWalletReady) {
      return { icon: CheckCircle2, text: "Ready", className: "text-green-600" };
    }
    if (isAnyWalletConnected) {
      // Use Clock icon for "Initializing..." - no spinning animation
      return { icon: Clock, text: "Initializing...", className: "text-yellow-600" };
    }
    return { icon: XCircle, text: "Not Connected", className: "text-red-600" };
  };

  const connectionStatus = getConnectionStatus();
  const StatusIcon = connectionStatus.icon;

  return (
    <main className="flex w-full flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CardUI
          title="Wallet Connection"
          description="Active wallet mode and connection status"
          icon={Wallet}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Active Mode</span>
              {getWalletModeBadge()}
            </div>
            <RowLabelInfo
              label="Connection Status"
              value={
                <div className="flex items-center gap-2">
                  <StatusIcon className={`h-4 w-4 ${connectionStatus.className}`} />
                  <span className={connectionStatus.className}>{connectionStatus.text}</span>
                </div>
              }
            />
            {(walletType === "utxos" || isUtxosEnabled || utxosWallet) && (
              <>
                <RowLabelInfo
                  label="UTXOS Wallet"
                  value={utxosWallet?.cardano ? "Connected" : utxosWallet ? "Initializing..." : "Enabled (Waiting...)"}
                />
                {utxosWallet?.cardano && (
                  <RowLabelInfo
                    label="Cardano Interface"
                    value="Available"
                  />
                )}
                {utxosWallet && !utxosWallet.cardano && (
                  <div className="text-sm text-yellow-600">
                    Waiting for wallet.cardano interface...
                  </div>
                )}
                {!utxosWallet && isUtxosEnabled && (
                  <div className="text-sm text-yellow-600">
                    Wallet enabled, initializing instance...
                  </div>
                )}
                {utxosError && (
                  <div className="text-sm text-red-600">
                    Error: {utxosError.message}
                  </div>
                )}
              </>
            )}
            {walletType === "regular" && connected && (
              <RowLabelInfo
                label="Regular Wallet"
                value="Connected"
              />
            )}
            <RowLabelInfo
              label="Active Wallet Instance"
              value={activeWallet ? "Available" : "Not Available"}
            />
            <RowLabelInfo
              label="User Address Set"
              value={userAddress ? "Yes" : "No"}
            />
            {activeWallet && (
              <RowLabelInfo
                label="Wallet Ready for Operations"
                value={isWalletReady ? "Yes" : "No"}
              />
            )}
            {!activeWallet && isAnyWalletConnected && (
              <div className="text-sm text-yellow-600">
                Wallet connection detected but instance not ready yet. This may take a few moments.
              </div>
            )}
          </div>
        </CardUI>

        <CardUI
          title="User Profile"
          description="Your account information"
          icon={UserIcon}
        >
          <div className="space-y-4">
            <RowLabelInfo
              label="Payment Address"
              value={getFirstAndLast(user.address, 12, 8)}
              copyString={user.address}
              allowOverflow={true}
            />
            <RowLabelInfo
              label="Stake Address"
              value={getFirstAndLast(user.stakeAddress, 12, 8)}
              copyString={user.stakeAddress}
              allowOverflow={true}
            />
            {user.drepKeyHash && user.drepKeyHash.length > 0 && (
              <RowLabelInfo
                label="DRep Key Hash"
                value={getFirstAndLast(user.drepKeyHash, 12, 8)}
                copyString={user.drepKeyHash}
                allowOverflow={true}
              />
            )}
          </div>
        </CardUI>

        {userAssets && userAssets.length > 0 && (
          <CardUI
            title="Wallet Assets"
            description="Assets in your connected wallet"
            icon={Shield}
          >
            <div className="space-y-2">
              {userAssets.map((asset, index) => {
                const isLovelace = asset.unit === "lovelace";
                const amount = isLovelace 
                  ? (parseInt(asset.quantity) / 1000000).toFixed(6) + " ADA"
                  : asset.quantity;
                return (
                  <RowLabelInfo
                    key={index}
                    label={isLovelace ? "ADA" : `Asset ${index + 1}`}
                    value={amount}
                    copyString={asset.unit}
                  />
                );
              })}
            </div>
          </CardUI>
        )}

        <CardUI
          title="Appearance"
          description="Personalize the app background"
          icon={Palette}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Animated background</p>
                <p className="text-xs text-muted-foreground">
                  Show a subtle animated aurora behind the app. Honors your
                  reduced-motion setting.
                </p>
              </div>
              <Switch
                checked={backgroundEnabled}
                onCheckedChange={setBackgroundEnabled}
                aria-label="Toggle animated background"
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Background style</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {BACKGROUND_PRESETS.map((preset) => {
                  const selected = backgroundPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={!backgroundEnabled}
                      onClick={() => setBackgroundPreset(preset.id)}
                      aria-pressed={selected}
                      className={cn(
                        "group relative overflow-hidden rounded-lg border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                        selected
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      <div className="relative h-16 w-full bg-background">
                        <Background
                          variant="aurora-static"
                          preset={preset.id}
                          showRadialGradient={false}
                          className="h-full w-full"
                        />
                      </div>
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <span className="text-xs font-medium">{preset.label}</span>
                        {selected && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {!backgroundEnabled && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Enable the animated background to choose a style.
                </p>
              )}
            </div>
          </div>
        </CardUI>

        <CardUI
          title="Connected Services"
          description="External accounts linked to your profile"
          icon={MessageCircle}
        >
          {discordData ? (
            <div className="space-y-2">
              <RowLabelInfo
                label="Discord"
                value={`Connected (ID: ${discordData})`}
                copyString={discordData}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No external services connected
            </div>
          )}
        </CardUI>

        <BotManagementCard />

        <CardUI
          title="Account Details"
          description="Additional account information"
          icon={Key}
          cardClassName="md:col-span-2"
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium mb-1">User ID</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {getFirstAndLast(user.id, 12, 8)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(user.id, "User ID")}
                className="flex-shrink-0 mt-1 sm:mt-0"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>
            {user.nostrKey && (() => {
              // Pin to a non-null local — nostrKey became nullable when the
              // Nostr chat system was removed in #253, but legacy users
              // still have a value persisted. The outer guard ensures the
              // block only renders when it's a string.
              const nostrKey = user.nostrKey;
              return (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-1">Nostr Key</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {(() => {
                        try {
                          const nostrKeyObj = JSON.parse(nostrKey);
                          const nsec = nostrKeyObj.nsec || "";
                          const pubkey = nostrKeyObj.pubkey || "";
                          return (
                            <span>
                              {`{"nsec":"${getFirstAndLast(nsec, 10, 8)}","pubkey":"${getFirstAndLast(pubkey, 10, 8)}"}`}
                            </span>
                          );
                        } catch {
                          return getFirstAndLast(nostrKey, 20, 8);
                        }
                      })()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(nostrKey, "Nostr Key")}
                    className="flex-shrink-0 mt-1 sm:mt-0"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </Button>
                </div>
              );
            })()}
          </div>
        </CardUI>
      </div>
    </main>
  );
}

