import React, { memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Send, 
  RefreshCw, 
  AlertCircle,
  Plus,
  Trash2,
  Wallet,
  Activity,
  ArrowRight,
  X
} from "lucide-react";

interface ProxyOutput {
  address: string;
  unit: string;
  amount: string;
}

interface ProxySpendProps {
  proxies: Array<{
    id: string;
    proxyAddress: string;
    authTokenId: string;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
  }> | undefined;
  selectedProxy: string;
  selectedProxyBalance: Array<{ unit: string; quantity: string }>;
  spendOutputs: ProxyOutput[];
  spendLoading: boolean;
  onProxySelection: (proxyId: string) => void;
  onSpendOutputsChange: (outputs: ProxyOutput[]) => void;
  onSpendFromProxy: () => void;
  onCloseSpend: () => void;
}

const ProxySpend = memo(function ProxySpend({
  proxies,
  selectedProxy,
  selectedProxyBalance,
  spendOutputs,
  spendLoading,
  onProxySelection,
  onSpendOutputsChange,
  onSpendFromProxy,
  onCloseSpend,
}: ProxySpendProps) {
  // Add spend output
  const addSpendOutput = () => {
    const newOutputs = [...spendOutputs, { address: "", unit: "lovelace", amount: "" }];
    onSpendOutputsChange(newOutputs);
  };

  // Remove spend output
  const removeSpendOutput = (index: number) => {
    if (spendOutputs.length > 1) {
      const newOutputs = spendOutputs.filter((_, i) => i !== index);
      onSpendOutputsChange(newOutputs);
    }
  };

  // Update spend output
  const updateSpendOutput = (index: number, field: keyof ProxyOutput, value: string) => {
    const updated = [...spendOutputs];
    if (updated[index]) {
      updated[index] = { ...updated[index], [field]: value };
      onSpendOutputsChange(updated);
    }
  };

  return (
    <div className="space-y-6">
      {/* Description */}
      <p className="text-sm text-muted-foreground">
        Create transactions to spend assets from your proxy address
      </p>

      {/* Collateral Requirement Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Collateral Required:</strong> Your wallet needs at least 5 ADA set aside as collateral for smart contract transactions. 
          If you encounter "No collateral found" errors, please set up collateral in your wallet settings.
        </AlertDescription>
      </Alert>

      {(!proxies || proxies.length === 0) && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No proxies found. Please setup a proxy first before attempting to spend from it.
          </AlertDescription>
        </Alert>
      )}

      {proxies && proxies.length > 0 && (
        <div className="space-y-6">
          {/* Proxy Selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-semibold">Select Proxy</Label>
            </div>
            <Select value={selectedProxy} onValueChange={onProxySelection}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a proxy to spend from" />
              </SelectTrigger>
              <SelectContent>
                {proxies.map((proxy) => (
                  <SelectItem key={proxy.id} value={proxy.id}>
                    <div className="flex flex-col">
                      <span className="font-mono text-sm">{proxy.proxyAddress.slice(0, 20)}...</span>
                      <span className="text-xs text-muted-foreground">{proxy.description || "No description"}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selected Proxy Balance */}
          {selectedProxy && selectedProxyBalance.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <Label className="text-base font-semibold">Proxy Balance</Label>
              </div>
              <div className="space-y-2">
                {selectedProxyBalance.map((asset, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {asset.unit === "lovelace" ? "ADA" : asset.unit}
                      </Badge>
                      <span className="font-mono text-sm">
                        {asset.unit === "lovelace" 
                          ? `${(parseFloat(asset.quantity) / 1000000).toFixed(6)} ADA`
                          : asset.quantity
                        }
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spend Outputs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Label className="text-base font-semibold">Spend Outputs</Label>
              </div>
              <Button variant="outline" size="sm" onClick={addSpendOutput}>
                <Plus className="h-4 w-4 mr-2" />
                Add Output
              </Button>
            </div>

            {spendOutputs.map((output, index) => (
              <div key={index} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Output {index + 1}</Label>
                  {spendOutputs.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeSpendOutput(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                    <Label htmlFor={`address-${index}`}>Address</Label>
                    <Input
                      id={`address-${index}`}
                      value={output.address}
                      onChange={(e) => updateSpendOutput(index, "address", e.target.value)}
                      placeholder="addr1..."
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`unit-${index}`}>Asset</Label>
                    <Input
                      id={`unit-${index}`}
                      value={output.unit}
                      onChange={(e) => updateSpendOutput(index, "unit", e.target.value)}
                      placeholder="lovelace or policyId.assetName"
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`amount-${index}`}>Amount</Label>
                    <Input
                      id={`amount-${index}`}
                      value={output.amount}
                      onChange={(e) => updateSpendOutput(index, "amount", e.target.value)}
                      placeholder="1000000"
                      type="number"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Separator />

          {/* Submit Button */}
          <Button
            onClick={onSpendFromProxy}
            disabled={spendLoading || !selectedProxy || !proxies || proxies.length === 0}
            className="w-full h-12"
            size="lg"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                {spendLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </div>
              {spendLoading ? "Creating spend transaction..." : "Create Spend Transaction"}
            </div>
          </Button>
        </div>
      )}
    </div>
  );
});

export default ProxySpend;
