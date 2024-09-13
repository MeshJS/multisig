import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Check, CheckIcon, Loader, MoreVertical } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import { Transaction } from "@prisma/client";
import { QuestionMarkIcon } from "@radix-ui/react-icons";
import { getFirstAndLast, lovelaceToAda } from "@/lib/strings";
import { Separator } from "@/components/ui/separator";
import { useUserStore } from "@/lib/zustand/user";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@meshsdk/react";
import { useToast } from "@/hooks/use-toast";

export default function TransactionCard({
  walletId,
  transaction,
}: {
  walletId: string;
  transaction: Transaction;
}) {
  const { wallet, connected } = useWallet();
  const { appWallet } = useAppWallet({ walletId });
  const userAddress = useUserStore((state) => state.userAddress);
  const txJson = JSON.parse(transaction.txJson);
  const [loading, setLoading] = useState<boolean>(false);
  const { toast } = useToast();
  const ctx = api.useUtils();

  const { mutate: updateTransaction } =
    api.transaction.updateTransaction.useMutation({
      onSuccess: async () => {
        toast({
          title: "Transaction Updated",
          description: "Your transaction has been updated",
          duration: 5000,
        });
        setLoading(false);
        void ctx.transaction.getPendingTransactions.invalidate();
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  async function signTx() {
    if (!connected) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");

    try {
      setLoading(true);

      const signedTx = await wallet.signTx(transaction.txCbor, true);

      const signedAddresses = transaction.signedAddresses;
      signedAddresses.push(userAddress);

      let state = transaction.state;
      let txHash = "";

      // check if this transaction is complete
      if (appWallet.numRequiredSigners == signedAddresses.length) {
        state = 1;
        txHash = await wallet.submitTx(signedTx);
      }

      updateTransaction({
        transactionId: transaction.id,
        txCbor: signedTx,
        signedAddresses: signedAddresses,
        state: state,
        txHash: txHash,
      });
    } catch (e) {
      setLoading(false);
      console.error(e);
    }
  }

  if (!appWallet) return <></>;
  return (
    <Card className="overflow-hidden" x-chunk="dashboard-05-chunk-4">
      <CardHeader className="flex flex-row items-start bg-muted/50">
        <div className="grid gap-0.5">
          <CardTitle className="group flex items-center gap-2 text-lg">
            {transaction.description}
            {/* <Button
                      size="icon"
                      variant="outline"
                      className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Copy className="h-3 w-3" />
                      <span className="sr-only">Copy Order ID</span>
                    </Button> */}
          </CardTitle>
          <CardDescription>
            {transaction.createdAt.toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "numeric",
            })}
          </CardDescription>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {/* <Button size="sm" variant="outline" className="h-8 gap-1">
                    <Truck className="h-3.5 w-3.5" />
                    <span className="lg:sr-only xl:not-sr-only xl:whitespace-nowrap">
                      Track Order
                    </span>
                  </Button> */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" className="h-8 w-8">
                <MoreVertical className="h-3.5 w-3.5" />
                <span className="sr-only">More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(transaction.txJson);
                }}
              >
                Copy Tx JSON
              </DropdownMenuItem>
              {/* <DropdownMenuItem>Export</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>Trash</DropdownMenuItem> */}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-6 text-sm">
        <div className="grid gap-3">
          <div className="font-semibold">Sending</div>
          <ul className="grid gap-3">
            {txJson.outputs.map((output: any) => {
              return (
                <li
                  key={output.address}
                  className="flex items-center justify-between"
                >
                  <span className="text-muted-foreground">
                    {getFirstAndLast(output.address)}
                  </span>
                  <span>
                    {lovelaceToAda(
                      output.amount.find(
                        (unit: any) => unit.unit === "lovelace",
                      ).quantity,
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <Separator className="my-2" />
          <div className="font-semibold">Signers</div>
          <ul className="grid gap-3">
            {appWallet.signersAddresses.map((signerAddress, index) => {
              return (
                <li
                  key={signerAddress}
                  className="flex items-center justify-between"
                >
                  <span className="text-muted-foreground">
                    {appWallet.signersDescriptions[index] &&
                    appWallet.signersDescriptions[index].length > 0
                      ? `${appWallet.signersDescriptions[index]} (${getFirstAndLast(signerAddress)})`
                      : getFirstAndLast(signerAddress)}
                    {signerAddress == userAddress && ` (You)`}
                  </span>
                  <span>
                    {transaction.signedAddresses.includes(signerAddress) ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : signerAddress == userAddress ? (
                      <Button
                        size="sm"
                        onClick={() => signTx()}
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader className="h-4 w-4 animate-spin" />
                        ) : (
                          "Sign"
                        )}
                      </Button>
                    ) : (
                      <QuestionMarkIcon className="h-4 w-4" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {/* <Separator className="my-4" />
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-3">
            <div className="font-semibold">Shipping Information</div>
            <address className="grid gap-0.5 not-italic text-muted-foreground">
              <span>Liam Johnson</span>
              <span>1234 Main St.</span>
              <span>Anytown, CA 12345</span>
            </address>
          </div>
          <div className="grid auto-rows-max gap-3">
            <div className="font-semibold">Billing Information</div>
            <div className="text-muted-foreground">
              Same as shipping address
            </div>
          </div>
        </div>
        <Separator className="my-4" />
        <div className="grid gap-3">
          <div className="font-semibold">Customer Information</div>
          <dl className="grid gap-3">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Customer</dt>
              <dd>Liam Johnson</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>
                <a href="mailto:">liam@acme.com</a>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Phone</dt>
              <dd>
                <a href="tel:">+1 234 567 890</a>
              </dd>
            </div>
          </dl>
        </div> */}
      </CardContent>
      {/* <CardFooter className="flex flex-row items-center border-t bg-muted/50 px-6 py-3">
                <div className="text-xs text-muted-foreground">
                  Updated <time dateTime="2023-11-23">November 23, 2023</time>
                </div>
                <Pagination className="ml-auto mr-0 w-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <Button size="icon" variant="outline" className="h-6 w-6">
                        <ChevronLeft className="h-3.5 w-3.5" />
                        <span className="sr-only">Previous Order</span>
                      </Button>
                    </PaginationItem>
                    <PaginationItem>
                      <Button size="icon" variant="outline" className="h-6 w-6">
                        <ChevronRight className="h-3.5 w-3.5" />
                        <span className="sr-only">Next Order</span>
                      </Button>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </CardFooter> */}
    </Card>
  );
}

function Row({
  walletId,
  transaction,
}: {
  walletId: string;
  transaction: Transaction;
}) {
  const { appWallet } = useAppWallet({ walletId });

  if (!appWallet) return <></>;

  return (
    <TableRow>
      <TableCell>
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium leading-none">Signers</p>
              <div>
                {appWallet.signersAddresses.map((signerAddress, index) => {
                  return (
                    <div key={signerAddress} className="flex gap-2">
                      {transaction.signedAddresses.includes(signerAddress) ? (
                        <CheckIcon className="h-4 w-4 text-green-400" />
                      ) : (
                        <QuestionMarkIcon className="h-4 w-4" />
                      )}
                      <p className="text-sm text-muted-foreground">
                        {appWallet.signersDescriptions[index] &&
                        appWallet.signersDescriptions[index].length > 0
                          ? `${appWallet.signersDescriptions[index]} (${getFirstAndLast(signerAddress)})`
                          : signerAddress}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium leading-none">Ouputs</p>
              <p className="text-sm text-muted-foreground">
                {JSON.parse(transaction.txJson).outputs.map((output: any) => {
                  return (
                    <div key={output.address} className="flex gap-2">
                      <p className="text-sm text-muted-foreground">
                        {output.address}
                      </p>
                    </div>
                  );
                })}
              </p>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right text-red-400">-₳ 250</TableCell>
    </TableRow>
  );
}
