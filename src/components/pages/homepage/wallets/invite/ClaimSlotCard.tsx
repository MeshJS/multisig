import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getFirstAndLast } from "@/utils/strings";

/**
 * Join card for fixed-script drafts (e.g. CIP-0146 discovery invites):
 * the signer set is fixed by the on-chain script, so instead of freely
 * appending, the connected wallet claims the placeholder slot whose key
 * hash it can prove ownership of.
 */
export default function ClaimSlotCard({
  userAddress,
  signerName,
  setSignerName,
  onClaim,
  loading,
}: {
  userAddress: string;
  signerName: string;
  setSignerName: (name: string) => void;
  onClaim: () => void;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim your signer slot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This wallet's signers are fixed by its on-chain script, and your
          connected wallet matches one of them. Claiming links your address
          to your slot so the wallet appears in your account once it's
          created.
        </p>
        <div className="space-y-2">
          <Label htmlFor="claim-signer-name">Your name (optional)</Label>
          <Input
            id="claim-signer-name"
            maxLength={32}
            placeholder="How co-signers should see you"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Claiming as <code>{getFirstAndLast(userAddress, 16, 10)}</code>
        </p>
        <div className="flex justify-end">
          <Button onClick={onClaim} disabled={loading} size="lg">
            {loading ? "Claiming…" : "Claim my slot"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
