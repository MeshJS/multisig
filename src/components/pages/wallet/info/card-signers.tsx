import { Key } from "lucide-react";
import { getFirstAndLast } from "@/lib/strings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "@/types/wallet";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export default function CardSigners({ appWallet }: { appWallet: Wallet }) {
  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Signers</CardTitle>
        <Key className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
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
                    {getFirstAndLast(signer, 10)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
