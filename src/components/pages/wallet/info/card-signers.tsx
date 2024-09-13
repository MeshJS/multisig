import { Key } from "lucide-react";
import { getFirstAndLast } from "@/lib/strings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "@/types/wallet";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function CardSigners({ appWallet }: { appWallet: Wallet }) {
  const { toast } = useToast();

  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Signers</CardTitle>
        <Key className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="mt-1 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            This wallet requires {appWallet.numRequiredSigners} signers to sign
            a transaction.
          </p>

          <div className="mt-1 flex flex-col gap-2">
            {appWallet.signersAddresses.map((signer, index) => (
              <div className="flex items-center gap-4" key={signer}>
                <div className="grid gap-1">
                  <p className="text-sm font-medium leading-none">
                    {appWallet.signersDescriptions[index] &&
                    appWallet.signersDescriptions[index].length > 0
                      ? appWallet.signersDescriptions[index]
                      : `Signer ${index + 1}`}
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(appWallet.address);
                      toast({
                        title: "Copied",
                        description: "Address copied to clipboard",
                        duration: 5000,
                      });
                    }}
                    className="justify-start truncate"
                  >
                    <p className="text-sm text-muted-foreground">{signer}</p>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* <Table>
          <TableBody>
            <TableRow>
              <TableCell>
                <p>
                  This wallet requires {appWallet.numRequiredSigners} signers to
                  sign a transaction.
                </p>
              </TableCell>
            </TableRow>
            {appWallet.signersAddresses.map((signer, index) => (
              <TableRow key={signer}>
                <TableCell>
                  <div className="font-medium">
                    {appWallet.signersDescriptions[index] &&
                    appWallet.signersDescriptions[index].length > 0
                      ? appWallet.signersDescriptions[index]
                      : `Signer ${index + 1}`}
                  </div>
                  <div className="hidden text-sm text-muted-foreground md:inline">
                    {getFirstAndLast(signer, 10, 20)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table> */}
      </CardContent>
    </Card>
  );
}
