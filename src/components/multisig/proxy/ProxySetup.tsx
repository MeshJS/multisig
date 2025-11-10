import React, { memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  RefreshCw, 
  AlertCircle, 
  CheckCircle,
  Copy,
  Settings,
  ChevronLeft,
  Play,
  Check
} from "lucide-react";
import { MeshTxBuilder } from "@meshsdk/core";

interface ProxySetupProps {
  setupStep: number;
  setupData: {
    paramUtxo?: { txHash: string; outputIndex: number };
    authTokenId?: string;
    proxyAddress?: string;
    txHex?: MeshTxBuilder;
    description?: string;
  };
  setupLoading: boolean;
  hasActiveWallet?: boolean;
  onInitializeSetup: (description?: string) => void;
  onConfirmSetup: () => void;
  onResetSetup: () => void;
  onCopyToClipboard: (text: string) => void;
  onCloseSetup: () => void;
}

// Step indicator component
const StepIndicator = ({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) => {
  return (
    <div className="flex items-center justify-center space-x-4 mb-6">
      {Array.from({ length: totalSteps }, (_, index) => (
        <div key={index} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              index < currentStep
                ? "bg-primary text-primary-foreground"
                : index === currentStep
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {index < currentStep ? <Check className="w-4 h-4" /> : index + 1}
          </div>
          {index < totalSteps - 1 && (
            <div
              className={`w-12 h-1 mx-2 ${
                index < currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
};

const ProxySetup = memo(function ProxySetup({
  setupStep,
  setupData,
  setupLoading,
  hasActiveWallet = true,
  onInitializeSetup,
  onConfirmSetup,
  onResetSetup,
  onCopyToClipboard,
  onCloseSetup,
}: ProxySetupProps) {
  const [description, setDescription] = React.useState("");
  
  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Follow the steps below to create a new proxy contract. This process will mint 10 auth tokens that you can use to control the proxy.
        </p>
      </div>

      <StepIndicator currentStep={setupStep} totalSteps={3} />

      {/* Collateral Requirement Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Collateral Required:</strong> Your wallet needs at least 5 ADA set aside as collateral for smart contract transactions. 
          If you encounter "No collateral found" errors, please set up collateral in your wallet settings.
        </AlertDescription>
      </Alert>

      {/* Step 0: Introduction */}
      {setupStep === 0 && (
        <div className="space-y-6">
          <div className="p-6 sm:p-8 border-2 border-dashed border-primary/20 rounded-xl bg-primary/5">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Play className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h4 className="text-lg font-semibold text-foreground mb-2">Ready to Setup Proxy</h4>
                <p className="text-sm text-muted-foreground">
                  This process will create a new proxy contract for automated transactions
                </p>
              </div>
            </div>
            
            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="proxy-description" className="text-sm font-medium">
                  Proxy Description (Optional)
                </Label>
                <Input
                  id="proxy-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter a description for this proxy..."
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Add a description to help identify this proxy later
                </p>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-card/60">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium">Generate proxy parameters and addresses</span>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-card/60">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium">Create a transaction to mint 10 auth tokens</span>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-card/60">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium">Store proxy information in your wallet</span>
                </div>
              </div>
            </div>
            
            <Alert className="mt-6 border-primary/20 bg-primary/5">
              <AlertCircle className="h-4 w-4 text-primary" />
              <AlertDescription className="text-foreground">
                You'll need to sign a transaction to complete the setup. Make sure you have sufficient ADA for transaction fees.
              </AlertDescription>
            </Alert>
          </div>

          {!hasActiveWallet && (
            <Alert className="mt-4 border-destructive/20 bg-destructive/5">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-foreground">
                <strong>Wallet Not Connected:</strong> Please connect a wallet (regular or UTXOS) before setting up a proxy contract.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={() => onInitializeSetup(description.trim() || undefined)}
            disabled={setupLoading || !hasActiveWallet}
            className="w-full h-14 font-semibold text-lg"
            size="lg"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                {setupLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </div>
              {setupLoading ? "Generating proxy parameters..." : "Start Proxy Setup"}
            </div>
          </Button>
        </div>
      )}

      {/* Step 1: Review Generated Parameters */}
      {setupStep === 1 && (
        <div className="space-y-4">
          <div className="p-6 border rounded-lg bg-primary/5">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-primary" />
              Proxy Parameters Generated
            </h4>
            <p className="text-sm text-muted-foreground mb-4">
              Review the generated proxy information before proceeding:
            </p>
          </div>

          <div className="space-y-4">
            <div className="p-4 border rounded-lg">
              <Label className="text-sm font-medium">Proxy Address</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={setupData.proxyAddress || ""}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopyToClipboard(setupData.proxyAddress || "")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="p-4 border rounded-lg">
              <Label className="text-sm font-medium">Auth Token Policy ID</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={setupData.authTokenId || ""}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopyToClipboard(setupData.authTokenId || "")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="p-4 border rounded-lg">
              <Label className="text-sm font-medium">Parameter UTxO</Label>
              <div className="text-sm font-mono text-muted-foreground">
                {setupData.paramUtxo ? 
                  `${setupData.paramUtxo.txHash.slice(0, 20)}... (${setupData.paramUtxo.outputIndex})` : 
                  "Not available"
                }
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onResetSetup}
              className="flex-1"
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={onConfirmSetup}
              disabled={setupLoading}
              className="flex-1"
            >
              {setupLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Confirm & Submit
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Setup Complete */}
      {setupStep === 2 && (
        <div className="space-y-4">
          <div className="p-6 border rounded-lg bg-primary/5">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-primary" />
              Proxy Setup Complete!
            </h4>
            <p className="text-sm text-muted-foreground mb-4">
              Your proxy has been successfully created and is ready to use. You can now spend from this proxy using the auth tokens.
            </p>
          </div>

          <div className="p-4 border rounded-lg">
            <Label className="text-sm font-medium">Your New Proxy</Label>
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Address:</span>
                <span className="font-mono text-sm">{setupData.proxyAddress?.slice(0, 30)}...</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Auth Tokens:</span>
                <span className="text-sm font-medium">10 tokens minted</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status:</span>
                <span className="text-sm font-medium text-primary">Active</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onResetSetup}
              className="flex-1"
            >
              <Settings className="h-4 w-4 mr-2" />
              Setup Another Proxy
            </Button>
            <Button
              onClick={onCloseSetup}
              className="flex-1"
            >
              <Check className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

export default ProxySetup;
