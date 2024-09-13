import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "@/types/wallet";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  const { toast } = useToast();

  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xl font-medium">Info</CardTitle>
        <Info className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="mt-1 flex flex-col gap-2">
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex items-center gap-4">
              <div className="flex gap-2 justify-center items-center">
                <p className="text-sm font-medium leading-none">DRep ID</p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(appWallet.dRepId);
                    toast({
                      title: "Copied",
                      description: "DRepID copied to clipboard",
                      duration: 5000,
                    });
                  }}
                  className="justify-start truncate p-0 m-0 h-auto"
                >
                  <p className="text-sm text-muted-foreground">
                    {appWallet.dRepId}
                  </p>
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex gap-2 justify-center items-center">
                <p className="text-sm font-medium leading-none">Status</p>
                <p className="text-sm text-muted-foreground">Not registered</p>
              </div>
            </div>

            <div>
              <Button disabled>Register DRep (coming soon)</Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
