import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import RowLabelInfo from "@/components/common/row-label-info";
import Code from "@/components/common/code";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";

interface ScriptPreview {
  nativeScript: any;
  scriptCbor: string;
  scriptAddress: string;
  jsonMetadata: any;
  stakeCredentialHash: string;
}

interface ScriptSettingsProps {
  numRequiredSigners: number;
  setNumRequiredSigners: (value: number) => void;
  signersAddresses: string[];
  scriptPreview: ScriptPreview | null;
  enabled: boolean;
}

export default function ScriptSettings({
  scriptPreview,
  numRequiredSigners,
  signersAddresses,
  setNumRequiredSigners,
  enabled
}: ScriptSettingsProps) {
  if (!enabled) {
    return 
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Script Settings</CardTitle>
        <CardDescription>
          Customize your wallet with advanced options, only if you know what you
          are doing
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Label htmlFor="description">Required signers</Label>

        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Select the number of signers required to approve a transaction to make
          it valid in this wallet.
        </p>
        <ToggleGroup
          type="single"
          variant="outline"
          value={numRequiredSigners.toString()}
        >
          {signersAddresses.length > 0 &&
            Array.from(
              { length: signersAddresses.length },
              (_, i) => i + 1,
            ).map((num) => (
              <ToggleGroupItem
                key={num}
                value={num.toString()}
                onClick={() => {
                  if (numRequiredSigners == num) {
                    setNumRequiredSigners(0);
                  } else {
                    setNumRequiredSigners(num);
                  }
                }}
              >
                {num}
              </ToggleGroupItem>
            ))}
        </ToggleGroup>
        {/* (Other UI elements remain unchanged) */}
        {scriptPreview ? (
          <>
            <RowLabelInfo
              label="Native Script"
              value={
                <Code>
                  {JSON.stringify(scriptPreview.nativeScript, null, 2)}
                </Code>
              }
            />
            <RowLabelInfo
              label="Script CBOR"
              value={<Code>{scriptPreview.scriptCbor}</Code>}
            />
            <RowLabelInfo
              label="Script Address"
              value={<Code>{scriptPreview?.scriptAddress || "N/A"}</Code>}
            />
            <RowLabelInfo
              label="Stake Credential Hash"
              value={<Code>{scriptPreview?.stakeCredentialHash || "N/A"}</Code>}
            />
          </>
        ) : (
          <p className="text-red-500">
            Unable to generate script preview. Check addresses and settings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
