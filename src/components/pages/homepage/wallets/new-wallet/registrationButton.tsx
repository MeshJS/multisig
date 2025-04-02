import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@meshsdk/react";
import { useToast } from "@/hooks/use-toast";
import { useSiteStore } from "@/lib/zustand/site";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { MultisigWallet } from "@/lib/helper/cip146/multisigScriptSdk";

export default function RegistrationButton({
  MSWallet,
}: {
  MSWallet: MultisigWallet;
}) {
  const { wallet, connected } = useWallet();
  const { toast } = useToast();
  const network = useSiteStore((state) => state.network);
  const userAddress = useUserStore((state) => state.userAddress);
  const [loading, setLoading] = useState(false);

  async function handleRegisterNewWallet() {
    if (!connected || !wallet) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet.",
        variant: "destructive",
      });
      return;
    }
    if (!userAddress) {
      toast({
        title: "No user address",
        description: "User address not found.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(userAddress);
      if (!utxos || utxos.length === 0) {
        throw new Error("No UTxOs found for the user address.");
      }
      // For simplicity, use all available UTxOs
      const selectedUtxos = utxos;
      const minLovelace = 1000000; // 1 ADA

      const txBuilder = getTxBuilder(network);
      // Add inputs from selected UTxOs
      for (const utxo of selectedUtxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
      }
      // Add an output sending minimal lovelace to the user's address
      txBuilder.txOut(userAddress, [
        { unit: "lovelace", quantity: minLovelace.toString() },
      ]);

      // Add auxiliary data with the registration metadata using MSWallet
      if (!MSWallet) {
        throw new Error("MSWallet not available for metadata generation.");
      }
      txBuilder.metadataValue(1854, MSWallet.getJsonMetadata());

      // Loop over desired roles and build a mapping of role to native script CBOR
      const roles = [0, 2, 3, 4, 5];
      roles.forEach((role) => {
        const script = MSWallet.buildScript(role);
        if (script) txBuilder.metadataValue(role, script);
      });

      const unsignedTx = await txBuilder.changeAddress(userAddress).complete();
      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);

      toast({
        title: "Registration Transaction Sent",
        description: txHash || "Transaction submitted successfully.",
        duration: 10000,
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      toast({
        title: "Registration Error",
        description: error.message || "An error occurred during registration.",
        duration: 10000,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleRegisterNewWallet} disabled={loading}>
      {loading ? "Sending Registration..." : "Send Registration"}
    </Button>
  );
}
