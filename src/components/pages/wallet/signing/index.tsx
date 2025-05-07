import React, { useState, useCallback } from "react";

import { useWallet } from "@meshsdk/react";
import { sign } from "@/utils/signing";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import useAppWallet from "@/hooks/useAppWallet";
import usePendingSignables from "@/hooks/usePendingSignables";
import useCompleteSignables from "@/hooks/useCompleteSignables";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import CardUI from "@/components/ui/card-content";
import { MoreVertical, Signature } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import SectionTitle from "@/components/common/section-title";
import SignableCard from "@/components/pages/wallet/signing/signable-card";
import {
  pubKeyAddress,
  resolvePaymentKeyHash,
  serializeAddressObj,
} from "@meshsdk/core";
import { Input } from "@/components/ui/input";

export default function WalletSigning() {
  const [signingMethod, setSigningMethod] = useState<string>("CIP-0095");
  const { wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const [payload, setPayload] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const ctx = api.useUtils();
  const setLoading = useSiteStore((state) => state.setLoading);
  const { appWallet } = useAppWallet();
  const { signables: pendingSignables } = usePendingSignables({
    walletId: appWallet && appWallet.id,
  });
  const { signables: completeSignables } = useCompleteSignables({
    walletId: appWallet && appWallet.id,
  });

  const { mutateAsync: createSignable } =
    api.signable.createSignable.useMutation({
      onSuccess: async () => {
        void ctx.signable.getPendingSignables.invalidate();
        void ctx.signable.getAllSignables.invalidate();
      },
      onError: (e) => {
        console.error("createSignable", e);
      },
    });

  const signPayload = useCallback(async () => {
    if (!appWallet) throw new Error("No wallet");
    if (!userAddress) throw new Error("No user address");

    //ToDo improve address selection Stake dRep etc.
    const paymentKeyHash = resolvePaymentKeyHash(userAddress);
    const paymentAddress = serializeAddressObj(
      pubKeyAddress(paymentKeyHash),
      1,
    );

    const signature = await sign(payload, wallet, 0, userAddress);

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
    //createSignable
    if (!signature?.signature) throw new Error("No Signature found");

    const signedAddresses = [];
    signedAddresses.push(userAddress);
    const signatures = [];
    signatures.push(`signature: ${signature.signature}, key: ${signature.key}`);

    let submitTx = false;

    if (appWallet.type == "any") {
      submitTx = true;
    } else if (
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

    await createSignable({
      walletId: appWallet.id,
      payload: payload,
      signatures: signatures,
      signedAddresses: signedAddresses,
      method: signingMethod,
      state: submitTx ? 1 : 0,
      description: description,
    });
  }, [
    payload,
    wallet,
    appWallet,
    userAddress,
    createSignable,
    toast,
    setLoading,
    signingMethod,
    description,
  ]);

  const selectCIP0030 = useCallback(() => setSigningMethod("CIP-0030"), []);
  const selectCIP0095 = useCallback(() => setSigningMethod("CIP-0095"), []);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid grid-cols-1 gap-4 md:gap-8">
        <CardUI
          title="Signing"
          description="Coordinated signing of arbitrary payloads as a group, by creating a new Signable."
          cardClassName="col-span-1 xl:col-span-2 shadow-md rounded-lg"
          headerDom={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-haspopup="true" size="icon" variant="ghost">
                  <Signature className="h-4 w-4" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={selectCIP0030}>
                  CIP-0030
                </DropdownMenuItem>
                <DropdownMenuItem onClick={selectCIP0095}>
                  CIP-0095
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          <br />
          <div className="grid gap-3">
            <Label htmlFor="description">Name</Label>
            <Input
              id="description"
              className="min-h-5"
              placeholder="Signable Name"
              value={description}
              onChange={(e) => {
                if (e.target.value.length <= 64)
                  setDescription(e.target.value);
              }}
            />
            {description.length >= 64 && (
              <p className="text-red-500">
                Name should be less than 64 characters.
              </p>
            )}
          </div>
          <br />
          <div className="grid gap-3">
            <Label htmlFor="payload">Payload</Label>
            <Textarea
              id="payload"
              className="min-h-32"
              placeholder="Payload to be signed"
              value={payload}
              onChange={(e) => {
                if (e.target.value.length <= 10000) setPayload(e.target.value);
              }}
            />
            {payload.length >= 10000 && (
              <p className="text-red-500">
                Payload should be less than 10000 characters.
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              onClick={signPayload}
              disabled={payload.length === 0}
              aria-label="Sign and share payload"
              className="focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Sign & Share
            </Button>
          </div>
        </CardUI>
      </div>
      {appWallet && pendingSignables && pendingSignables.length > 0 && (
        <section role="region" aria-labelledby="pending-transactions-title">
          <SectionTitle>Pending Signables</SectionTitle>
          <br/>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 md:gap-8">
            {pendingSignables.map((sig) => (
              <SignableCard
                key={sig.id}
                walletId={appWallet!.id}
                signable={sig}
              />
            ))}
          </div>
        </section>
      )}
      {appWallet && completeSignables && completeSignables.length > 0 && (
        <section role="region" aria-labelledby="pending-transactions-title">
          <SectionTitle>Complete Signables</SectionTitle>
          <br/>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 md:gap-8">
            {completeSignables.map((sig) => (
              <SignableCard
                key={sig.id}
                walletId={appWallet!.id}
                signable={sig}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
