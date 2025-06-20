import { useEffect, useState, useRef } from "react";
import axios from "axios";
import CardUI from "@/components/ui/card-content";
import { Wallet } from "@/types/wallet";
import { MultisigWallet } from "@/utils/multisigSDK";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import { type Quantity, type Unit } from "@meshsdk/core";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import router from "next/router";

export function RegisterWallet({
  appWallet,
  mWallet,
}: {
  appWallet: Wallet;
  mWallet?: MultisigWallet;
}) {
  const { connected, wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const setLoading = useSiteStore((state) => state.setLoading);
  const [error, setError] = useState<string | undefined>(undefined);
  const network = useSiteStore((state) => state.network);

  const keys = mWallet?.keys;
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);

  const hasTriggered = useRef(false);

  useEffect(() => {
    if (
      hasTriggered.current ||
      !mWallet ||
      !mWallet.keys ||
      mWallet.keys.length === 0
    ) {
      return;
    }

    hasTriggered.current = true;

    const checkRegistration = async () => {
      try {
        const pubKeyHashes = mWallet.keys.map((k) => k.keyHash).join(",");
        const response = await axios.get(`/api/v1/lookupMultisigWallet`, {
          params: { pubKeyHashes },
        });
        console.log(response);
        const matched = response.data.length > 0;
        setIsRegistered(matched);
      } catch (error) {
        console.error("Error checking registration:", error);
        setIsRegistered(false);
      }
    };

    checkRegistration();
  }, [mWallet]);

  async function sendRegistration() {
    if (!connected) throw new Error("Wallet not connected");
    if (!mWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");
    const json = mWallet.getJsonMetadata();

    setLoading(true);
    setError(undefined);

    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(userAddress);

      if (utxos.length === 0) {
        setError(
          "Insufficient funds, no UTxOs were found in the depositors wallet",
        );
        return;
      }
      const txBuilder = getTxBuilder(network);
      const unsignedTx = await txBuilder
        .selectUtxosFrom(utxos)
        .changeAddress(userAddress)
        .metadataValue('1854',json)
        .metadataScript(mWallet.getScript().scriptCbor, "Native")
        .complete();

      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);
      toast({
        title: "Transaction Created",
        description: txHash ?? "Your transaction has been created",
        duration: 10000,
      });

      setLoading(false);
    } catch (e) {
      setLoading(false);

      toast({
        title: "Error",
        description: `${e}`,
        duration: 10000,
        action: (
          <ToastAction
            altText="Try again"
            onClick={() => {
              navigator.clipboard.writeText(e);
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

  return (
    <>
      {isRegistered === false && (
        <CardUI
          title="Register Wallet"
          description="Register your Wallet through a CIP-0146 registration transaction."
          cardClassName="col-span-2"
        >
          <button
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
            onClick={() => sendRegistration()}
          >
            Register Wallet
          </button>
        </CardUI>
      )}
    </>
  );
}
