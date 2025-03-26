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
import { useMemo, useState } from "react";
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
import { csl } from "@meshsdk/core-csl";
import sendDiscordMessage from "@/lib/discord/sendDiscordMessage";
import { TooltipProvider, TooltipTrigger } from "@radix-ui/react-tooltip";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";

const DiscordIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    fill="currentColor"
    viewBox="0 0 16 16"
  >
    <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612" />
  </svg>
);
import { useWalletsStore } from "@/lib/zustand/wallets";

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

  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

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

  const { data: discordIds } = api.user.getDiscordIds.useQuery({
    addresses: appWallet?.signersAddresses || [],
  });

  async function sendReminder(signerAddress: string) {
    try {
      const discordId = discordIds?.[signerAddress];
      if (!discordId) return;

      const response = await sendDiscordMessage(
        [discordId],
        `**REMINDER:** Your signature is needed for a transaction in ${appWallet?.name}. Review it here: ${window.location.origin}/wallets/${appWallet?.id}/transactions`,
      );

      toast({
        title: "Reminder Sent",
        description: "Discord reminder has been sent to the user",
        duration: 5000,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description:
          "Failed to send Discord reminder. Please make sure the user is in the MeshJS Discord Server.",
        variant: "destructive",
        duration: 5000,
      });
    }
  }

  function handleError(e: any) {
    let hasKnownError = false;

    if (e.code == 2 && e.info == "user declined sign tx") {
      hasKnownError = true;
    }

    if (!hasKnownError) {
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

  async function signTx() {
    if (!connected) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");

    try {
      setLoading(true);

      const signedTx = await wallet.signTx(transaction.txCbor, true);

      // sanity check
      const tx = csl.Transaction.from_hex(signedTx);
      const vkeys = tx.witness_set().vkeys();
      const len = vkeys?.len() || 0;

      if (len != transaction.signedAddresses.length + 1) {
        setLoading(false);
        toast({
          title: "Error",
          description: `Error signing transaction. Please try again.`,
          duration: 5000,
          variant: "destructive",
        });
        return;
      }

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
      handleError(e);
    }
  }

  async function rejectTx() {
    if (!userAddress) throw new Error("User address not found");

    try {
      setLoading(true);
      const userRewardAddress = (await wallet.getRewardAddresses())[0];
      const nonce = generateNonce("Reject this transaction: ");
      const signature = await wallet.signData(nonce, userRewardAddress);
      const result = await checkSignature(nonce, signature);

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

  // for checking only
  // useEffect(() => {
  //   function getBech32(publicKey: string) {
  //     const address = csl.EnterpriseAddress.new(
  //       csl.NetworkId.mainnet().kind(), // change network here
  //       csl.Credential.from_keyhash(
  //         csl.PublicKey.from_bech32(publicKey).hash(),
  //       ),
  //     )
  //       .to_address()
  //       .to_bech32();
  //     return address;
  //   }

  //   const txcbor =
  //     "84a300d90102818258209407c9436202687c4a89404c02e0ff2d04d2f67d7baa78933f02732db232a52d010182825839115b5e8a6a0841092c8e7b35eee23065659eb3f3677a0d60f6e8e9f24a9d4dcd7e454d2434164f4efb8edeb358d86a1dad9ec6224cfcbce3e61a00a7d8c082583911d90ec48b994d1a164be3f92b3e36453aa835331c275f170f7196899f9d4dcd7e454d2434164f4efb8edeb358d86a1dad9ec6224cfcbce3e61b00000016ff0142fd021a00030b85a20082825820f11443b4cf980f156472196a7f5f62cd66148c01e9c27dfd66a4688c24e44ffd58400df2837cf1368740ecbfcc8547f3e142281f3298a857b5b849e0079267f7cd2c87f3bd651a9768b2d6a407009e2669a7a879efe07ef3f8d1ee0d17bee41c0e0f825820ccce8b734cd72c3216a24c8458bb227135a84c10e0cacceaebcf4159d2d3b8915840c4de6edef2cfda3cb407a4d5ace27c67e18760374d424e9cbb74198b490c45aa1c96def7c0f47c33d9ce29bc8006e93e93f181f2e15caf73903390d9e921b20c01d9010281830304868200581cda5c4cbb27c2481c188e5ee601ad7b92e6b10301522545bcb256bb848200581cc4f540c890e6bccfa8d1efde2f3f67a489df09a2a1de8efbe45694d58200581c5859238a6c56239a86c48012e0e3d12b68ba09efa2f9abf2f0038f0b8200581cbc12c8d159e2f49d665b1c551f982e9b38d415f5d3941d1f76d903508200581c626da6df5c85bd2aa85d199d57af350cd583d2913ed98b168374a5d58200581c77dff27e22e60be84a10fb2b5fac36955a7bc1be3c611a6e4581e569f5f6";
  //   const tx = csl.Transaction.from_hex(txcbor);
  //   const vkeys = tx.witness_set().vkeys();
  //   const len = vkeys?.len() || 0;
  //   for (let i = 0; i < len; i++) {
  //     const pubkey = vkeys?.get(i).vkey().public_key().to_bech32();
  //     if (pubkey) {
  //       const address = getBech32(pubkey);
  //       console.log("address", address);
  //     }
  //   }
  // }, []);

  const outputList = useMemo((): JSX.Element => {
    return (
      <>
        {txJson.outputs.map((output: any, i: number) => {
          return (
            <div key={i} className="flex gap-2">
              <div className="font-weight-400">
                {output.amount.map((unit: any, j: number) => {
                  const assetMetadata = walletAssetMetadata[unit.unit];
                  const decimals =
                    unit.unit === "lovelace"
                      ? 6
                      : (assetMetadata?.decimals ?? 0);
                  const assetName =
                    unit.unit === "lovelace"
                      ? "₳"
                      : assetMetadata?.ticker
                        ? `$${assetMetadata?.ticker}`
                        : unit.unit;
                  return (
                    <span key={`${unit.unit}-${j}`}>
                      {j > 0 && " + "}
                      {unit.quantity / Math.pow(10, decimals)} {assetName}
                    </span>
                  );
                })}
              </div>
              <span
                className="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground"
                style={{ maxWidth: "100%", display: "inline-block" }}
              >
                {" "}
                to{" "}
                {output.address.length > 20
                  ? `${output.address.slice(0, 10)}...${output.address.slice(-10)}`
                  : output.address}
              </span>
            </div>
          );
        })}
      </>
    );
  }, [txJson, walletAssetMetadata]);

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
              {/* <DropdownMenuItem
                onClick={() => {
                  rebuildTx(); // todo add confirmation
                }}
              >
                Rebuild Transaction
              </DropdownMenuItem> */}
              <DropdownMenuItem
                onClick={() => {
                  deleteTx(); // todo add confirmation
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
              <ul className="grid gap-3">{outputList}</ul>
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
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {appWallet.signersDescriptions[index] &&
                      appWallet.signersDescriptions[index].length > 0
                        ? `${appWallet.signersDescriptions[index]} (${getFirstAndLast(signerAddress)})`
                        : getFirstAndLast(signerAddress)}
                      {signerAddress == userAddress && ` (You)`}
                    </span>
                    {signerAddress !== userAddress &&
                      !transaction.signedAddresses.includes(signerAddress) &&
                      discordIds &&
                      Object.keys(discordIds).includes(signerAddress) && (
                        <span className="flex items-center">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                {!transaction.signedAddresses.includes(
                                  signerAddress,
                                ) &&
                                  discordIds &&
                                  Object.keys(discordIds).includes(
                                    signerAddress,
                                  ) && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0"
                                      onClick={() =>
                                        sendReminder(signerAddress)
                                      }
                                    >
                                      <DiscordIcon />
                                    </Button>
                                  )}
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Send a Discord reminder.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </span>
                      )}
                  </div>
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
