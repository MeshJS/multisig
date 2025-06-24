import { useState } from "react";
import { ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReviewNativeScript from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewNativeScript";
import type { MultisigWallet } from "@/utils/multisigSDK";


interface AdvancedSectionProps {
  advancedConfig: {
    stakeKey: string;
    setStakeKey: (stakeKey: string) => void;
    nativeScriptType: "all" | "any" | "atLeast";
    setNativeScriptType: (type: "all" | "any" | "atLeast") => void;
  };
  mWallet: MultisigWallet | undefined;
  onSave?: (stakeKey: string, scriptType: "all" | "any" | "atLeast") => void;
}

const CollapsibleAdvancedSection: React.FC<AdvancedSectionProps> = ({ 
  advancedConfig, 
  mWallet,
  onSave 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditingStake, setIsEditingStake] = useState(false);
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [tempStakeKey, setTempStakeKey] = useState(advancedConfig.stakeKey);
  const [tempScriptType, setTempScriptType] = useState(advancedConfig.nativeScriptType);
  
  const handleSaveStake = () => {
    advancedConfig.setStakeKey(tempStakeKey);
    setIsEditingStake(false);
    if (onSave) {
      onSave(tempStakeKey, advancedConfig.nativeScriptType);
    }
  };
  
  const handleCancelStake = () => {
    setTempStakeKey(advancedConfig.stakeKey);
    setIsEditingStake(false);
  };

  const handleSaveScript = () => {
    advancedConfig.setNativeScriptType(tempScriptType);
    setIsEditingScript(false);
    if (onSave) {
      onSave(advancedConfig.stakeKey, tempScriptType);
    }
  };
  
  const handleCancelScript = () => {
    setTempScriptType(advancedConfig.nativeScriptType);
    setIsEditingScript(false);
  };

  return (
    <>
      {/* Divider */}
      <Separator className="my-8" />
      
      {/* Advanced Section Header */}
      <div className="mb-4 sm:mb-6">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg font-medium hover:text-primary transition-colors"
        >
          {isExpanded ? <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" /> : <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />}
          Advanced
        </button>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
          Optional settings and native script
        </p>
      </div>
      
      {/* Expandable Content */}
      {isExpanded && (
        <div className="space-y-4 sm:space-y-6 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
          {/* Stake Credential Card */}
          <Card className="overflow-hidden">
            {isEditingStake && (
              <>
                {/* Back button at the very top of the card */}
                <div className="px-6 py-3">
                  <button
                    onClick={() => setIsEditingStake(false)}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground py-1.5"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back to stake credential
                  </button>
                </div>
                {/* Divider */}
                <div className="px-6">
                  <div className="border-b" />
                </div>
              </>
            )}
            <CardHeader>
              <CardTitle>{isEditingStake ? "Edit" : "Stake Credential"}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-hidden">
              {isEditingStake ? (
                /* Edit Mode */
                <div className="space-y-4">
                  {/* Edit Form with background like Add Signer */}
                  <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                    <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 sm:items-start">
                      <Label htmlFor="stakeKey" className="text-sm sm:pt-2">Hash</Label>
                      <div>
                        <Input
                          id="stakeKey"
                          type="text"
                          placeholder="Stake credential hash..."
                          value={tempStakeKey}
                          onChange={(e) => setTempStakeKey(e.target.value)}
                          className="w-full text-sm font-mono"
                        />
                        {tempStakeKey.length > 0 && tempStakeKey.length < 56 && (
                          <p className="text-xs text-red-500 mt-1">
                            Stake credential hash must be 56 characters long
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Edit Actions */}
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" size="sm" onClick={handleCancelStake}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveStake}>
                      Apply
                    </Button>
                  </div>
                </div>
              ) : (
                /* Display Mode */
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Optional: Set a specific stake credential for this wallet. Changes will be applied when you create the wallet, but not be saved before creation.
                  </p>
                  <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                    <span className="text-sm text-muted-foreground">Hash</span>
                    <span className="font-mono text-xs">
                      {advancedConfig.stakeKey || "Not set"}
                    </span>
                  </div>
                  {/* Edit button */}
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTempStakeKey(advancedConfig.stakeKey);
                        setIsEditingStake(true);
                      }}
                      className="w-full sm:w-auto"
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Script Type Card */}
          <Card className="overflow-hidden">
            {isEditingScript && (
              <>
                {/* Back button at the very top of the card */}
                <div className="px-6 py-3">
                  <button
                    onClick={() => setIsEditingScript(false)}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground py-1.5"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back to script type
                  </button>
                </div>
                {/* Divider */}
                <div className="px-6">
                  <div className="border-b" />
                </div>
              </>
            )}
            <CardHeader>
              <CardTitle>{isEditingScript ? "Edit" : "Script Type"}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-hidden">
              {isEditingScript ? (
                /* Edit Mode */
                <div className="space-y-4">
                  {/* Edit Form with background */}
                  <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                    <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 sm:items-center">
                      <Label className="text-sm">Type</Label>
                      <div>
                        <Select
                          value={tempScriptType}
                          onValueChange={(value: "all" | "any" | "atLeast") => setTempScriptType(value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="atLeast">
                              At Least — N of M must sign (recommended)
                            </SelectItem>
                            <SelectItem value="all">
                              All — Every signer must approve
                            </SelectItem>
                            <SelectItem value="any">
                              Any — Any single signer can approve
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Changes will be applied when you create the wallet, but not be saved before creation.
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* Edit Actions */}
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" size="sm" onClick={handleCancelScript}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveScript}>
                      Apply
                    </Button>
                  </div>
                </div>
              ) : (
                /* Display Mode */
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Optional: Choose the native script type. Changes will be applied when you create the wallet, but not be saved before creation.
                  </p>
                  <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <span className="text-sm">
                      {advancedConfig.nativeScriptType === 'atLeast' && 'At Least — N of M must sign'}
                      {advancedConfig.nativeScriptType === 'all' && 'All — Every signer must approve'}
                      {advancedConfig.nativeScriptType === 'any' && 'Any — Any single signer can approve'}
                    </span>
                  </div>
                  {/* Edit button */}
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTempScriptType(advancedConfig.nativeScriptType);
                        setIsEditingScript(true);
                      }}
                      className="w-full sm:w-auto"
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Native Script - New Review Component */}
          <ReviewNativeScript mWallet={mWallet} />
        </div>
      )}
    </>
  );
};

export default CollapsibleAdvancedSection;