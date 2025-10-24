import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type MultisigWallet } from "@/utils/multisigSDK";
import { deserializeAddress } from "@meshsdk/core";
import useAppWallet from "@/hooks/useAppWallet";
import { getBalanceFromUtxos } from "@/utils/getBalance";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Custom RowLabelInfo with top alignment and code blocks
function RowLabelInfo({
  label,
  value,
  copyString,
}: {
  label: string;
  value: string | React.ReactNode;
  copyString?: string;
}) {
  const { toast } = useToast();
  
  const handleCopy = () => {
    if (copyString) {
      navigator.clipboard.writeText(copyString);
      toast({
        title: "Copied!",
        description: "Copied to clipboard",
        duration: 3000,
      });
    }
  };
  
  return (
    <div className="flex flex-col gap-1 max-w-full overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {label}
        </div>
        {copyString && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="flex-shrink-0 h-auto p-1"
          >
            <Copy className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="text-sm text-muted-foreground w-full">
        {typeof value === 'string' && value.startsWith('{') ? (
          <pre className="font-mono text-xs whitespace-pre-wrap break-all">
            {value}
          </pre>
        ) : (
          <span className="break-all block">{value}</span>
        )}
      </div>
    </div>
  );
}

export default function ReviewNativeScript({
  mWallet,
}: {
  mWallet?: MultisigWallet;
}) {
  const { appWallet } = useAppWallet();
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const [balance, setBalance] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>("basics");

  useEffect(() => {
    if (!appWallet) return;
    const utxos = walletsUtxos[appWallet.id];
    if (!utxos) return;
    const balance = getBalanceFromUtxos(utxos);
    if (!balance) return;
    setBalance(balance);
  }, [appWallet, walletsUtxos]);

  if (!mWallet) return null;
  
  let dSAddr;
  try {
    dSAddr = deserializeAddress(mWallet.getScript().address);
  } catch (error) {
    console.error("Failed to get script address:", error);
    return (
      <div className="p-4 border rounded-lg bg-red-50 border-red-200">
        <p className="text-red-800 text-sm">
          Unable to generate script address. Please check your wallet configuration.
        </p>
      </div>
    );
  }

  const menuItems = [
    { id: "basics", label: "Basics" },
    { id: "metadata", label: "Metadata (1854)" },
    { id: "payment", label: "Payment Script" },
    ...(mWallet?.buildScript(2) !== undefined && mWallet.stakingEnabled() 
      ? [{ id: "stake", label: "Stake Script" }] 
      : []),
    ...(mWallet?.buildScript(3) !== undefined && mWallet.isGovernanceEnabled() 
      ? [{ id: "drep", label: "DRep Script" }] 
      : []),
  ];

  const renderContent = () => {
    switch (activeTab) {
      case "basics":
        return (
          <div className="space-y-4 min-h-[200px]">
            <RowLabelInfo
              label="Address"
              value={mWallet.getScript().address}
              copyString={mWallet.getScript().address}
            />
            <RowLabelInfo 
              label="Balance" 
              value={`${balance} ₳`}
              copyString={`${balance} ₳`}
            />
            {mWallet.stakingEnabled() && (
              <RowLabelInfo
                label="Stake Address"
                value={mWallet.getStakeAddress()}
                copyString={mWallet.getStakeAddress()}
              />
            )}
            <RowLabelInfo
              label="dRep ID"
              value={mWallet.getDRepId()}
              copyString={mWallet.getDRepId()}
            />
          </div>
        );
      
      case "metadata":
        return (
          <div className="min-h-[200px]">
            <RowLabelInfo
              label="1854 Metadata"
              value={JSON.stringify(mWallet?.getJsonMetadata(), null, 2)}
              copyString={JSON.stringify(mWallet?.getJsonMetadata(), null, 2)}
            />
          </div>
        );
      
      case "payment":
        return (
          <div className="space-y-4 min-h-[200px]">
            <RowLabelInfo
              label="Payment Script"
              value={JSON.stringify(mWallet?.buildScript(0), null, 2)}
              copyString={JSON.stringify(mWallet?.buildScript(0), null, 2)}
            />
            <RowLabelInfo 
              label="Keyhash" 
              value={dSAddr.scriptHash}
              copyString={dSAddr.scriptHash}
            />
            <RowLabelInfo
              label="CBOR"
              value={mWallet.getPaymentScript()}
              copyString={mWallet.getPaymentScript()}
            />
            {appWallet?.stakeCredentialHash && (
              <RowLabelInfo
                label="Stake Credential Hash"
                value={appWallet?.stakeCredentialHash}
                copyString={appWallet?.stakeCredentialHash}
              />
            )}
          </div>
        );
      
      case "stake":
        return (
          <div className="space-y-4 min-h-[200px]">
            <RowLabelInfo
              label="Stake Script"
              value={JSON.stringify(mWallet.buildScript(2), null, 2)}
              copyString={JSON.stringify(mWallet.buildScript(2), null, 2)}
            />
            <RowLabelInfo
              label="Keyhash"
              value={dSAddr.stakeScriptCredentialHash}
              copyString={dSAddr.stakeScriptCredentialHash}
            />
            <RowLabelInfo
              label="CBOR"
              value={mWallet.getStakingScript()}
              copyString={mWallet.getStakingScript()}
            />
          </div>
        );
      
      case "drep":
        return (
          <div className="space-y-4 min-h-[200px]">
            <RowLabelInfo
              label="DRep Script"
              value={JSON.stringify(mWallet.buildScript(3), null, 2)}
              copyString={JSON.stringify(mWallet.buildScript(3), null, 2)}
            />
            <RowLabelInfo
              label="DRep Script CBOR"
              value={mWallet.getDRepScript()}
              copyString={mWallet.getDRepScript()}
            />
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Native Script</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-hidden">
        {/* Mobile: Dropdown, Desktop: Sidebar */}
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 w-full">
          {/* Mobile: Dropdown */}
          <div className="w-full lg:hidden">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {menuItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Desktop: Sidebar */}
          <div className="hidden lg:block lg:w-48 lg:flex-shrink-0">
            <nav className="flex flex-col gap-1 space-y-1">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm rounded-md transition-colors",
                    activeTab === item.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          
          {/* Content Area */}
          <div className="flex-1 min-w-0 overflow-x-auto">
            <div className="min-w-0">
              {renderContent()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}