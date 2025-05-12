import React, { useMemo, useState, useCallback } from "react";
import { Signable } from "@prisma/client";

import { useWallet } from "@meshsdk/react";
import { csl } from "@meshsdk/core-csl";
import { pubKeyAddress, serializeAddressObj } from "@meshsdk/core";
import { sign } from "@/utils/signing";

import { useToast } from "@/hooks/use-toast";
import useAppWallet from "@/hooks/useAppWallet";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { dateToFormatted, getFirstAndLast, lovelaceToAda } from "@/utils/strings";
import sendDiscordMessage from "@/lib/discord/sendDiscordMessage";
import { TooltipProvider, TooltipTrigger } from "@radix-ui/react-tooltip";
import { QuestionMarkIcon } from "@radix-ui/react-icons";
import { Check, Loader, MoreVertical, X, ChevronDown } from "lucide-react";

import { Button as ShadcnButton } from "@/components/ui/button";
import Button from "@/components/common/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { checkSignature, generateNonce } from "@meshsdk/core";
import { ToastAction } from "@/components/ui/toast";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import DiscordIcon from "@/components/common/discordIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function SignableCard({
  walletId,
  signable,
}: {
  walletId: string;
  signable: Signable;
}) {
  const { wallet, connected } = useWallet();
  const { appWallet } = useAppWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const [loading, setLoading] = useState<boolean>(false);
  const { toast } = useToast();
  const ctx = api.useUtils();

  const { mutate: updateSignable } = api.signable.updateSignable.useMutation({
    onSuccess: async () => {
      toast({
        title: "Signable Updated",
        description: "Your signable has been updated",
        duration: 5000,
      });
      setLoading(false);
      void ctx.signable.getPendingSignables.invalidate();
      void ctx.signable.getAllSignables.invalidate();
    },
    onError: (e) => {
      console.error(e);
      setLoading(false);
    },
  });

  const { mutate: deleteSignable } = api.signable.deleteSignable.useMutation({
    onSuccess: async () => {
      toast({
        title: "Signable Deleted",
        description: "Your signable has been deleted",
        duration: 5000,
      });
      setLoading(false);
      void ctx.signable.getPendingSignables.invalidate();
      void ctx.signable.getAllSignables.invalidate();
    },
    onError: (e) => {
      console.error(e);
      setLoading(false);
    },
  });

  const { data: discordIds } = api.user.getDiscordIds.useQuery({
    addresses: appWallet?.signersAddresses || [],
  });

  const sendReminder = useCallback(
    async (signerAddress: string) => {
      try {
        const discordId = discordIds?.[signerAddress];
        if (!discordId) return;

        await sendDiscordMessage(
          [discordId],
          `**REMINDER:** Your signature is needed for a Datum in ${appWallet?.name}. Review it here: ${window.location.origin}/wallets/${appWallet?.id}/signing`,
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
            "Failed to send Discord reminder. Please make sure the user is on the MeshJS Discord Server.",
          variant: "destructive",
          duration: 5000,
        });
      }
    },
    [discordIds, appWallet, toast],
  );

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

  const signPayload = useCallback(async () => {
    if (!connected) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");

    try {
      setLoading(true);

      const signature = await sign(signable.payload, wallet, 0, userAddress);

      if (!signature?.signature) {
        setLoading(false);
        toast({
          title: "Error",
          description: `Error signing payload. Please try again.`,
          duration: 5000,
          variant: "destructive",
        });
        return;
      }

      const signedAddresses = signable.signedAddresses;
      signedAddresses.push(userAddress);

      const signatures = signable.signatures;
      signatures.push(
        `signature: ${signature.signature}, key: ${signature.key}`,
      );

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

      updateSignable({
        signableId: signable.id,
        signedAddresses: signedAddresses,
        signatures: signatures,
        rejectedAddresses: signable.rejectedAddresses,
        state: submitTx ? 1 : 0,
      });
    } catch (e) {
      console.error(e);
      setLoading(false);
      handleError(e);
    }
  }, [connected, appWallet, signable, userAddress, updateSignable]);

  const rejectPayload = useCallback(async () => {
    if (!userAddress) throw new Error("User address not found");

    try {
      setLoading(true);
      const userRewardAddress = (await wallet.getRewardAddresses())[0];
      const nonce = generateNonce("Reject this transaction: ");
      const signature = await wallet.signData(nonce, userRewardAddress);
      const result = await checkSignature(nonce, signature);

      const rejectedAddresses = signable.rejectedAddresses;
      rejectedAddresses.push(userAddress);

      if (result) {
        updateSignable({
          signableId: signable.id,
          signedAddresses: signable.signedAddresses,
          signatures: signable.signatures,
          rejectedAddresses: rejectedAddresses,
          state: signable.state,
        });
      }
    } catch (e) {
      console.error(e);
      toast({
        title: "Signable Updated",
        description: "Your signable has been updated",
        duration: 5000,
      });
      navigator.clipboard.writeText(JSON.stringify(e));
    }
    setLoading(false);
  }, [userAddress, wallet, signable, updateSignable, toast]);

  const deletePayload = useCallback(() => {
    setLoading(true);
    deleteSignable({
      signableId: signable.id,
    });
  }, [deleteSignable, signable]);

  const handleRemindAll = useCallback(() => {
    appWallet?.signersAddresses.map((signerAddress) => {
      if (!signable.signedAddresses.includes(signerAddress)) {
        sendReminder(signerAddress);
      }
    });
  }, [appWallet, signable, sendReminder]);

  if (!appWallet) return <></>;
  return (
    <Card
      role="region"
      aria-labelledby={`signable-${signable.id}-title`}
      className="w-full self-start overflow-hidden rounded-lg shadow-md transition-shadow duration-200 hover:shadow-lg"
    >
      <CardHeader className="flex flex-col items-start space-y-2 rounded-t-lg bg-muted/10 p-4 sm:flex-row sm:space-y-0 sm:p-6">
        <div className="grid gap-0.5">
          <CardTitle
            id={`signable-${signable.id}-title`}
            className="group flex items-center gap-2 text-lg"
          >
            {signable.description}
          </CardTitle>
          <CardDescription>
            {dateToFormatted(signable.createdAt)}
          </CardDescription>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton
                size="icon"
                variant="outline"
                className="h-8 w-8 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                aria-label="More options"
              >
                <MoreVertical className="h-3.5 w-3.5" />
                <span className="sr-only">More</span>
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(signable.payload);
                  toast({
                    title: "Copied",
                    description: "JSON copied to clipboard",
                    duration: 5000,
                  });
                }}
              >
                Copy Payload
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={deletePayload}>
                Delete Transaction
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 bg-muted/5 p-4 text-sm sm:space-y-6 sm:p-6">
        <div className="grid gap-3">
          <div className="font-semibold">Payload</div>
          <pre className="w-full overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs md:text-sm">
            {signable.payload}
          </pre>

          <div>
            <Separator className="my-2" />
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between font-semibold">
                Signatures
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signature</TableHead>
                    <TableHead>Key</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signable.signatures.map((sigStr, idx) => {
                    const [sigPart = "", keyPart = ""] = sigStr.split(", key: ");
                    const signature = sigPart.replace("signature: ", "");
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <code className="break-all">{signature}</code>
                        </TableCell>
                        <TableCell>
                          <code className="break-all">{keyPart}</code>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </details>
          </div>

          <Separator className="my-2" />

          <div className="flex items-center gap-2">
            <div className="font-semibold">Signers</div>
            <Button size="sm" variant="outline" onClick={handleRemindAll}>
              <div className="flex flex-row items-center gap-1">
                Remind All
                <DiscordIcon />
              </div>
            </Button>
          </div>

          <ul className="divide-y divide-border">
            {appWallet.signersAddresses.map((signerAddress, index) => {
              const descriptionText =
                appWallet.signersDescriptions[index] &&
                appWallet.signersDescriptions[index].length > 0
                  ? `${appWallet.signersDescriptions[index]} (${getFirstAndLast(signerAddress)})`
                  : getFirstAndLast(signerAddress);
              const canRemind =
                signerAddress !== userAddress &&
                !signable.signedAddresses.includes(signerAddress) &&
                discordIds &&
                Object.keys(discordIds).includes(signerAddress);
              return (
                <li
                  key={signerAddress}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {descriptionText}
                      {signerAddress === userAddress && " (You)"}
                    </span>
                    {canRemind && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => sendReminder(signerAddress)}
                            >
                              <div className="flex items-center gap-1">
                                Remind
                                <DiscordIcon />
                              </div>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Send a Discord reminder.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <span>
                    {signable.signedAddresses.includes(signerAddress) ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : signable.rejectedAddresses.includes(signerAddress) ? (
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
        !signable.signedAddresses.includes(userAddress) &&
        !signable.rejectedAddresses.includes(userAddress) && (
          <CardFooter className="flex flex-col items-center space-y-2 border-t bg-muted/10 p-4 sm:flex-row sm:justify-end sm:space-x-3 sm:space-y-0">
            <Button onClick={signPayload} disabled={loading}>
              {loading ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                "Approve & Sign"
              )}
            </Button>
            <Button
              variant="destructive"
              onClick={rejectPayload}
              disabled={loading}
            >
              {loading ? <Loader className="h-4 w-4 animate-spin" /> : "Reject"}
            </Button>
          </CardFooter>
        )}

      {(appWallet.type == "atLeast" &&
        signable.rejectedAddresses.length >= appWallet.numRequiredSigners!) ||
        (appWallet.type == "all" &&
          signable.rejectedAddresses.length ==
            appWallet.signersAddresses.length) ||
        (appWallet.type == "any" && (
          <>
            <CardFooter className="flex flex-col items-center space-y-2 border-t bg-muted/10 p-4 sm:flex-row sm:justify-end sm:space-x-3 sm:space-y-0">
              <Button
                variant="destructive"
                onClick={deletePayload}
                disabled={loading}
                loading={loading}
                hold={3000}
              >
                Delete Signable
              </Button>
            </CardFooter>
          </>
        ))}
    </Card>
  );
}

export default React.memo(SignableCard);
