import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle } from "lucide-react";
import React from "react";
import { checkValidStakeKey } from "@/utils/multisigSDK";

type NativeScriptType = "all" | "any" | "atLeast";

interface AdvancedConfig {
  stakeKey: string;
  setStakeKey: (stakeKey: string) => void;
  nativeScriptType: NativeScriptType;
  setNativeScriptType: (type: NativeScriptType) => void;
}

interface NWAdvancedOptionsCardProps {
  advancedConfig: AdvancedConfig;
}

const NWAdvancedOptionsCard: React.FC<NWAdvancedOptionsCardProps> = ({ advancedConfig }) => {
  const {
    stakeKey,
    setStakeKey,
    nativeScriptType,
    setNativeScriptType,
  } = advancedConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Advanced Options</CardTitle>
        <CardDescription>
          Customize your wallet with optional settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8">
          {/* Stake Key Input */}
          <div className="grid gap-2">
            <Label htmlFor="stakeKey">Stake Key (optional)</Label>
            <Input
              id="stakeKey"
              type="text"
              placeholder="Enter stake address or credential hash (optional)"
              value={stakeKey}
              onChange={(e) => setStakeKey(e.target.value)}
              className={`w-full font-mono ${
                stakeKey
                  ? checkValidStakeKey(stakeKey)
                    ? "!border-green-500 focus:!border-green-500"
                    : "!border-red-500 focus:!border-red-500"
                  : ""
              }`}
            />
            {stakeKey && checkValidStakeKey(stakeKey) && (
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <p className="text-xs text-green-500">
                  Valid stake key format
                </p>
              </div>
            )}
            {stakeKey && !checkValidStakeKey(stakeKey) && (
              <div className="flex items-center gap-1">
                <XCircle className="h-3 w-3 text-red-500" />
                <p className="text-xs text-red-500">
                  Invalid stake key format
                </p>
              </div>
            )}
          </div>

          {/* Native Script Type Select */}
          <div className="grid gap-2">
            <Label htmlFor="scriptType">Native Script Type</Label>
            <Select
              value={nativeScriptType}
              onValueChange={(value) => setNativeScriptType(value as NativeScriptType)}
              defaultValue="atLeast"
            >
              <SelectTrigger id="scriptType">
                <SelectValue placeholder="Select script type" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="atLeast">
                    At Least — N of M must sign
                  </SelectItem>
                  <SelectItem value="all">
                    All — Every signer must sign
                  </SelectItem>
                  <SelectItem value="any">
                    Any — One signer suffices
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              Choose how many signers must approve transactions.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NWAdvancedOptionsCard;