import React, { useMemo, useState } from "react";

import { checkSignature, generateNonce } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { csl } from "@meshsdk/core-csl";

import sendDiscordMessage from "@/lib/discord/sendDiscordMessage";
import {
  dateToFormatted,
  getFirstAndLast,
  lovelaceToAda,
  truncateTokenSymbol,
} from "@/utils/strings";
import { useUserStore } from "@/lib/zustand/user";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import useAppWallet from "@/hooks/useAppWallet";
import { useToast } from "@/hooks/use-toast";
import { Transaction } from "@prisma/client";

import { TooltipProvider, TooltipTrigger } from "@radix-ui/react-tooltip";

import { Check, Loader, MoreVertical, X, User, Copy, CheckCircle2, XCircle, MinusCircle, Vote, ChevronDown, ChevronUp, Award, UserMinus, UserPlus, UserCog } from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import DiscordIcon from "@/components/common/discordIcon";
import { Button as ShadcnButton } from "@/components/ui/button";
import Button from "@/components/common/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { get } from "http";
import { getProvider } from "@/utils/get-provider";
import { useSiteStore } from "@/lib/zustand/site";

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
  const [isSignersOpen, setIsSignersOpen] = useState<boolean>(false);
  const { toast } = useToast();
  const ctx = api.useUtils();
  const network = useSiteStore((state) => state.network);
  const blockchainProvider =getProvider(network);

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

      await sendDiscordMessage(
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

      const signerAmount = transaction.signedAddresses.length + 1;

      if (len % signerAmount != 0) {
        setLoading(false);
        toast({
          title: "Error",
          description: `Error signing transaction. Please try again. Not matching signer amount multiple.`,
          duration: 5000,
          variant: "destructive",
        });
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
        //txHash = await blockchainProvider.submitTx(signedTx);
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

  const outputList = useMemo((): React.ReactElement => {
    return (
      <>
        {txJson.outputs.map((output: any, i: number) => {
          return (
            <div key={i} className="flex items-start gap-3 py-1">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">
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
                          ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                          : truncateTokenSymbol(unit.unit);
                    return (
                      <span key={`${unit.unit}-${j}`}>
                        {j > 0 && " + "}
                        {unit.quantity / Math.pow(10, decimals)} {assetName}
                      </span>
                    );
                  })}
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  to {output.address.length > 20
                    ? `${output.address.slice(0, 10)}...${output.address.slice(-10)}`
                    : output.address}
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  }, [txJson, walletAssetMetadata]);

  function handleRemindAll() {
    appWallet?.signersAddresses.map((signerAddress) => {
      if (!transaction.signedAddresses.includes(signerAddress)) {
        sendReminder(signerAddress);
      }
    });
  }

  function VoteBadge({ voteKind }: { voteKind: "Yes" | "No" | "Abstain" }) {
    const config = {
      Yes: {
        icon: CheckCircle2,
        className: "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30",
      },
      No: {
        icon: XCircle,
        className: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30",
      },
      Abstain: {
        icon: MinusCircle,
        className: "bg-muted text-muted-foreground border-border/50",
      },
    };

    const { icon: Icon, className } = config[voteKind];

    return (
      <Badge
        variant="outline"
        className={`flex items-center gap-1.5 text-xs font-semibold ${className}`}
      >
        <Icon className="h-3 w-3" />
        <span>{voteKind}</span>
      </Badge>
    );
  }

  if (!appWallet) return <></>;
  
  // Calculate signing threshold info
  const signersCount = appWallet.signersAddresses.length;
  const requiredSigners = appWallet.numRequiredSigners ?? signersCount;
  const signedCount = transaction.signedAddresses.length;
  const rejectedCount = transaction.rejectedAddresses.length;
  
  const getSignersText = () => {
    if (appWallet.type === 'all') {
      return `All ${signersCount} signers required`;
    } else if (appWallet.type === 'any') {
      return `Any of ${signersCount} signers`;
    } else {
      return `${requiredSigners} of ${signersCount} signers`;
    }
  };
  
  const getRequiredCount = () => {
    if (appWallet.type === 'all') {
      return signersCount;
    } else if (appWallet.type === 'any') {
      return 1;
    } else {
      return requiredSigners;
    }
  };
  
  const requiredCount = getRequiredCount();
  const isComplete = signedCount >= requiredCount;
  const progressPercentage = Math.min((signedCount / signersCount) * 100, 100);
  const thresholdPercentage = (requiredCount / signersCount) * 100;
  const pendingCount = signersCount - signedCount - rejectedCount;
  
  return (
    <Card className="self-start overflow-hidden w-full">
      <CardHeader className="flex flex-col gap-3 bg-muted/50 p-4 sm:p-6">
        <div className="flex flex-row items-start w-full">
          <div className="grid gap-0.5 flex-1 min-w-0 pr-2">
            <CardTitle className="group flex items-center gap-2 text-base sm:text-lg break-words">
              {transaction.description}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {dateToFormatted(transaction.createdAt)}
            </CardDescription>
          </div>
          <div className="ml-auto flex items-center gap-1 flex-shrink-0">
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
        </div>
        
        {/* Signing Threshold - Person Icons with Progress Bar */}
        <div className="w-full pt-3 border-t border-border/30">
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">
              {getSignersText()}
            </div>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: signersCount }).map((_, index) => {
                let iconColor = "text-muted-foreground opacity-30"; // Light gray (not required, not signed)
                
                if (index < signedCount) {
                  iconColor = "text-green-500 dark:text-green-400"; // Green (signed, starting from left)
                } else if (index < requiredCount) {
                  iconColor = "text-foreground opacity-100"; // White (threshold requirement, not signed)
                }
                
                return (
                  <User
                    key={index}
                    className={`h-5 w-5 sm:h-6 sm:w-6 ${iconColor}`}
                  />
                );
              })}
            </div>
            {/* Progress Bar */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="h-2.5 bg-muted rounded-full overflow-visible shadow-inner relative cursor-help">
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-foreground/40 z-10"
                      style={{ left: `${thresholdPercentage}%` }}
                    >
                      <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-foreground/60" />
                    </div>
                    <div
                      className={`h-full transition-all duration-500 ease-out relative rounded-full ${
                        isComplete
                          ? "bg-gradient-to-r from-green-500 to-green-600 shadow-sm shadow-green-500/50"
                          : "bg-gradient-to-r from-primary to-primary/90"
                      }`}
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1 text-xs">
                    <div className="font-semibold">{getSignersText()}</div>
                    <div className="text-muted-foreground">
                      {signedCount} signed
                      {rejectedCount > 0 && ` • ${rejectedCount} rejected`}
                      {pendingCount > 0 && ` • ${pendingCount} pending`}
                    </div>
                    <div className="text-muted-foreground">
                      Progress: {signedCount} / {requiredCount} required
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 text-sm">
        <div className="grid gap-3 sm:gap-4 max-w-4xl mx-auto w-full">
          {txJson.outputs.length > 0 && (
            <>
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Sending
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/50 p-3 space-y-2">
                  {outputList}
                </div>
              </div>
              <Separator className="my-2" />
            </>
          )}

          {/* Votes Section */}
          {txJson.votes && txJson.votes.length > 0 && (
            <>
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Votes
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/50 p-3 space-y-3">
                  {txJson.votes.map((vote: any, index: number) => {
                    const voteKind = vote.vote?.votingProcedure?.voteKind;
                    let voteKindDisplay: "Yes" | "No" | "Abstain" = "Abstain";
                    if (voteKind) {
                      const normalized = voteKind.toLowerCase();
                      if (normalized === "yes") {
                        voteKindDisplay = "Yes";
                      } else if (normalized === "no") {
                        voteKindDisplay = "No";
                      } else {
                        voteKindDisplay = "Abstain";
                      }
                    }
                    const drepId = vote.vote?.voter?.drepId || "Unknown";
                    const govActionId = vote.vote?.govActionId;
                    const govActionHash = govActionId?.txHash || "Unknown";
                    const govActionIndex = govActionId?.txIndex ?? "Unknown";

                    return (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <VoteBadge voteKind={voteKindDisplay} />
                          <span className="text-xs text-muted-foreground">on</span>
                          <div className="flex items-center gap-1.5">
                            <Vote className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs font-medium">Governance Action</span>
                          </div>
                        </div>
                        <div className="space-y-1.5 pl-5">
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">DRep:</span>{" "}
                            <span className="font-mono">{getFirstAndLast(drepId)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">Action ID:</span>{" "}
                            <span className="font-mono">
                              {getFirstAndLast(govActionHash)}#{govActionIndex}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Separator className="my-2" />
            </>
          )}

          {/* Certificates Section */}
          {txJson.certificates && txJson.certificates.length > 0 && (
            <>
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Certificates
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/50 p-3 space-y-3">
                  {txJson.certificates.map((cert: any, index: number) => {
                    const certType = cert.certType?.type;
                    let certIcon = Award;
                    let certLabel = "Certificate";
                    let certColor = "text-muted-foreground";
                    let certDetails: React.ReactNode = null;

                    if (certType === "DRepDeregistration") {
                      certIcon = UserMinus;
                      certLabel = "DRep Deregistration";
                      certColor = "text-orange-500 dark:text-orange-400";
                      const drepId = cert.certType?.drepId || "Unknown";
                      const coin = cert.certType?.coin;
                      certDetails = (
                        <div className="space-y-1.5 pl-5">
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">DRep ID:</span>{" "}
                            <span className="font-mono">{getFirstAndLast(drepId)}</span>
                          </div>
                          {coin && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Refund:</span>{" "}
                              <span className="text-green-500 dark:text-green-400 font-medium">
                                +{lovelaceToAda(parseInt(coin))} ₳
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    } else if (certType === "DRepRegistration") {
                      certIcon = UserPlus;
                      certLabel = "DRep Registration";
                      certColor = "text-blue-500 dark:text-blue-400";
                      const drepId = cert.certType?.drepId || "Unknown";
                      const deposit = cert.certType?.deposit;
                      certDetails = (
                        <div className="space-y-1.5 pl-5">
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">DRep ID:</span>{" "}
                            <span className="font-mono">{getFirstAndLast(drepId)}</span>
                          </div>
                          {deposit && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Deposit:</span>{" "}
                              <span className="text-red-500 dark:text-red-400 font-medium">
                                -{lovelaceToAda(parseInt(deposit))} ₳
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    } else if (certType === "DRepUpdate") {
                      certIcon = UserCog;
                      certLabel = "DRep Update";
                      certColor = "text-purple-500 dark:text-purple-400";
                      const drepId = cert.certType?.drepId || "Unknown";
                      certDetails = (
                        <div className="space-y-1.5 pl-5">
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">DRep ID:</span>{" "}
                            <span className="font-mono">{getFirstAndLast(drepId)}</span>
                          </div>
                        </div>
                      );
                    }

                    const Icon = certIcon;

                    return (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className={`flex items-center gap-1.5 ${certColor}`}>
                            <Icon className="h-4 w-4" />
                            <span className="text-xs font-medium">{certLabel}</span>
                          </div>
                        </div>
                        {certDetails}
                      </div>
                    );
                  })}
                </div>
              </div>
              <Separator className="my-2" />
            </>
          )}

          {/* Signers List - Collapsible */}
          <Collapsible open={isSignersOpen} onOpenChange={setIsSignersOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors group">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Signers ({signersCount})
              </div>
              {isSignersOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground transition-transform" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
                  {/* Remind All Button */}
                  {pendingCount > 0 && (
                    <div className="pb-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={handleRemindAll} 
                        className="w-full hover:bg-primary/10 hover:border-primary/50 transition-colors"
                      >
                        <div className="flex flex-row items-center gap-1.5">
                          <DiscordIcon className="h-3.5 w-3.5" />
                          <span>Remind All Signers</span>
                        </div>
                      </Button>
                    </div>
                  )}
                  {appWallet.signersAddresses.map((signerAddress, index) => {
                    const hasSigned = transaction.signedAddresses.includes(signerAddress);
                    const hasRejected = transaction.rejectedAddresses.includes(signerAddress);
                    const isPending = !hasSigned && !hasRejected;
                    const isYou = signerAddress === userAddress;
                    const canRemind = !isYou && 
                                     isPending &&
                                     discordIds &&
                                     Object.keys(discordIds).includes(signerAddress);
                    
                    return (
                      <div
                        key={signerAddress}
                        className={`flex items-center gap-3 p-3.5 rounded-lg border transition-all hover:shadow-sm ${
                          hasSigned
                            ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/15"
                            : hasRejected
                            ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/15"
                            : isYou
                            ? "bg-primary/5 border-primary/20 hover:bg-primary/10"
                            : "bg-muted/40 border-border/40 hover:bg-muted/60"
                        }`}
                      >
                        <div className={`flex-shrink-0 ${
                          hasSigned
                            ? "text-green-600 dark:text-green-400"
                            : hasRejected
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}>
                          {hasSigned ? (
                            <div className="p-2 rounded-full bg-green-500/20 border border-green-500/30">
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                          ) : hasRejected ? (
                            <div className="p-2 rounded-full bg-red-500/20 border border-red-500/30">
                              <X className="h-4 w-4" />
                            </div>
                          ) : (
                            <div className="p-2 rounded-full bg-muted border border-border/50">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-medium break-words">
                              {appWallet.signersDescriptions[index] &&
                              appWallet.signersDescriptions[index].length > 0
                                ? appWallet.signersDescriptions[index]
                                : getFirstAndLast(signerAddress)}
                            </div>
                            {isYou && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-semibold border border-primary/30">
                                You
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(signerAddress);
                              toast({
                                title: "Address copied",
                                description: "Signer address copied to clipboard",
                                duration: 2000,
                              });
                            }}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 font-mono hover:text-foreground transition-colors group"
                          >
                            <span>{getFirstAndLast(signerAddress)}</span>
                            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        </div>
                        {canRemind && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => sendReminder(signerAddress)}
                                  className="h-8 px-2 flex-shrink-0"
                                >
                                  <div className="flex flex-row items-center gap-1.5">
                                    <DiscordIcon className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline text-xs">Remind</span>
                                  </div>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Send a Discord reminder</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    );
                  })}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardContent>

      {userAddress &&
        !transaction.signedAddresses.includes(userAddress) &&
        !transaction.rejectedAddresses.includes(userAddress) && (
          <CardFooter className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-t bg-muted/50 px-4 sm:px-6 py-3">
            <Button onClick={() => signTx()} disabled={loading} className="w-full sm:w-auto flex-1">
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
              className="w-full sm:w-auto flex-1"
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
            <CardFooter className="flex items-center justify-center border-t bg-muted/50 px-4 sm:px-6 py-3">
              <Button
                variant="destructive"
                onClick={() => deleteTx()}
                disabled={loading}
                loading={loading}
                hold={3000}
                className="w-full sm:w-auto"
              >
                Delete Transaction
              </Button>
            </CardFooter>
          </>
        ))}
    </Card>
  );
}
