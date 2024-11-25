import { api } from "@/utils/api";
import { Button as ShadcnButton } from "@/components/ui/button";
import Button from "@/components/common/button";
import { Check, Loader, MoreVertical, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import { Transaction } from "@prisma/client";
import { QuestionMarkIcon } from "@radix-ui/react-icons";
import { dateToFormatted, getFirstAndLast, lovelaceToAda } from "@/lib/strings";
import { Separator } from "@/components/ui/separator";
import { useUserStore } from "@/lib/zustand/user";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@meshsdk/react";
import { useToast } from "@/hooks/use-toast";
import { checkSignature, generateNonce } from "@meshsdk/core";
import { ToastAction } from "@/components/ui/toast";

export default function TransactionCard({
  walletId,
  transaction,
}: {
  walletId: string;
  transaction: Transaction;
}) {
  const { wallet, connected } = useWallet();
  const { appWallet } = useAppWallet();
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
        void ctx.transaction.getAllTransactions.invalidate();
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  const { mutate: deleteTransaction } =
    api.transaction.deleteTransaction.useMutation({
      onSuccess: async () => {
        toast({
          title: "Transaction Deleted",
          description: "Your transaction has been deleted",
          duration: 5000,
        });
        setLoading(false);
        void ctx.transaction.getPendingTransactions.invalidate();
        void ctx.transaction.getAllTransactions.invalidate();
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

      let txHash = "";
      let submitTx = false;

      if (
        appWallet.type == "atLeast" &&
        appWallet.numRequiredSigners == signedAddresses.length
      ) {
        submitTx = true;
      } else if (
        appWallet.type == "all" &&
        appWallet.signersAddresses.length == signedAddresses.length
      ) {
        submitTx = true;
      }

      if (submitTx) {
        txHash = await wallet.submitTx(signedTx);
      }

      updateTransaction({
        transactionId: transaction.id,
        txCbor: signedTx,
        signedAddresses: signedAddresses,
        rejectedAddresses: transaction.rejectedAddresses,
        state: submitTx ? 1 : 0,
        txHash: txHash,
      });
    } catch (e) {
      console.error(e);
      setLoading(false);
      toast({
        title: "Error",
        description: `${JSON.stringify(e)}`,
        duration: 10000,
        action: (
          <ToastAction
            altText="Try again"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(e));
              toast({
                title: "Error Copied",
                description: `Error has been copied to your clipboard.`,
                duration: 5000,
              });
            }}
          >
            Copy Error
          </ToastAction>
        ),
        variant: "destructive",
      });
    }
  }

  async function rejectTx() {
    if (!userAddress) throw new Error("User address not found");

    try {
      setLoading(true);
      const userRewardAddress = (await wallet.getRewardAddresses())[0];
      const nonce = generateNonce("Reject this transaction: ");
      const signature = await wallet.signData(nonce, userRewardAddress);
      const result = checkSignature(nonce, signature);

      const rejectedAddresses = transaction.rejectedAddresses;
      rejectedAddresses.push(userAddress);

      if (result) {
        updateTransaction({
          transactionId: transaction.id,
          txCbor: transaction.txCbor,
          signedAddresses: transaction.signedAddresses,
          rejectedAddresses: rejectedAddresses,
          state: transaction.state,
        });
      }
    } catch (e) {
      console.log(111);
      console.error(e);
      toast({
        title: "Transaction Updated",
        description: "Your transaction has been updated",
        duration: 5000,
      });
      navigator.clipboard.writeText(JSON.stringify(e));
    }
    setLoading(false);
  }

  async function deleteTx() {
    setLoading(true);
    deleteTransaction({
      transactionId: transaction.id,
    });
  }

  if (!appWallet) return <></>;
  return (
    <Card className="self-start overflow-hidden">
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
            {dateToFormatted(transaction.createdAt)}
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
              <ShadcnButton size="icon" variant="outline" className="h-8 w-8">
                <MoreVertical className="h-3.5 w-3.5" />
                <span className="sr-only">More</span>
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(transaction.txJson);
                  toast({
                    title: "Copied",
                    description: "JSON copied to clipboard",
                    duration: 5000,
                  });
                }}
              >
                Copy Tx JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(transaction.txCbor);
                  toast({
                    title: "Copied",
                    description: "CBOR copied to clipboard",
                    duration: 5000,
                  });
                }}
              >
                Copy Tx CBOR
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  deleteTx();
                }}
              >
                Delete Transaction
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-6 text-sm">
        <div className="grid gap-3">
          {txJson.outputs.length > 0 && (
            <>
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
            </>
          )}
          {txJson.changeAddress != appWallet.address && (
            <>
              <div className="font-semibold">Sending</div>
              <ul className="grid gap-3">
                {txJson.inputs.map((input: any) => {
                  return (
                    <li
                      key={input.txIn.txHash}
                      className="flex items-center justify-between"
                    >
                      <span className="text-muted-foreground">
                        {getFirstAndLast(txJson.changeAddress)}
                      </span>
                      <span>
                        {lovelaceToAda(
                          input.txIn.amount.find(
                            (unit: any) => unit.unit === "lovelace",
                          ).quantity,
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Separator className="my-2" />
            </>
          )}

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
                    ) : transaction.rejectedAddresses.includes(
                        signerAddress,
                      ) ? (
                      <X className="h-4 w-4 text-red-400" />
                    ) : (
                      <QuestionMarkIcon className="h-4 w-4" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>

      {userAddress &&
        !transaction.signedAddresses.includes(userAddress) &&
        !transaction.rejectedAddresses.includes(userAddress) && (
          <CardFooter className="flex items-center justify-between border-t bg-muted/50 px-6 py-3">
            <Button onClick={() => signTx()} disabled={loading}>
              {loading ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                "Approve & Sign"
              )}
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectTx()}
              disabled={loading}
            >
              {loading ? <Loader className="h-4 w-4 animate-spin" /> : "Reject"}
            </Button>
          </CardFooter>
        )}

      {(appWallet.type == "atLeast" &&
        transaction.rejectedAddresses.length >=
          appWallet.numRequiredSigners!) ||
        (appWallet.type == "all" &&
          transaction.rejectedAddresses.length ==
            appWallet.signersAddresses.length) ||
        (appWallet.type == "any" && (
          <>
            <CardFooter className="flex items-center justify-between border-t bg-muted/50 px-6 py-3">
              <Button
                variant="destructive"
                onClick={() => deleteTx()}
                disabled={loading}
                loading={loading}
                hold={3000}
              >
                Delete Transaction
              </Button>
            </CardFooter>
          </>
        ))}
    </Card>
  );
}
