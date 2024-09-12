import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "@/types/wallet";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export default function CardInfo({ wallet }: { wallet: Wallet }) {
  const { toast } = useToast();

  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Info</CardTitle>
        <Info className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="mt-1 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{wallet.description}</p>

          <div className="mt-1 flex flex-col gap-2">
            <div className="flex items-center gap-4">
              <div className="grid gap-1">
                <p className="text-sm font-medium leading-none">Address</p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(wallet.address);
                    toast({
                      title: "Copied",
                      description: "Address copied to clipboard",
                      duration: 5000,
                    });
                  }}
                >
                  <p className="text-sm text-muted-foreground">
                    {wallet.address}
                  </p>
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="grid gap-1">
                <p className="text-sm font-medium leading-none">DRep ID</p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(wallet.dRepId);
                    toast({
                      title: "Copied",
                      description: "DRepID copied to clipboard",
                      duration: 5000,
                    });
                  }}
                >
                  <p className="text-sm text-muted-foreground">
                    {wallet.dRepId}
                  </p>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
