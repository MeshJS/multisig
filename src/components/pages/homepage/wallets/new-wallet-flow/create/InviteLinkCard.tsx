import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface InviteLinkCardProps {
  walletId: string;
}

export default function InviteLinkCard({ walletId }: InviteLinkCardProps) {
  const { toast } = useToast();
  const inviteLink = `https://multisig.meshjs.dev/wallets/invite/${walletId}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(inviteLink);
    toast({
      title: "Copied!",
      description: "Invite link copied to clipboard",
      duration: 3000,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share Invite Link</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4">
        <p className="text-xs sm:text-sm text-muted-foreground">
          Share this link with other signers to add them to your wallet.
        </p>
        
        <div className="flex items-center gap-2 p-2.5 sm:p-3 bg-muted rounded-md">
          <code className="text-xs sm:text-sm flex-1 break-all">
            {inviteLink}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
            className="flex-shrink-0 h-8 w-8 sm:h-9 sm:w-9 p-0"
          >
            <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}