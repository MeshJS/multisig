import { useState } from "react";
import Button from "@/components/common/button";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { getProvider } from "@/utils/get-provider";
import useTransaction from "@/hooks/useTransaction";
import { keepRelevant, Quantity, Unit } from "@meshsdk/core";
import { Wallet } from "@/types/wallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";

interface VoteButtonProps {
  appWallet: Wallet;
  proposalId: string;
  description?: string;
  metadata?: string;
}

export default function VoteButton({
  appWallet,
  proposalId,
  description = "",
  metadata = "",
}: VoteButtonProps) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const [loading, setLoading] = useState(false);
  const [voteKind, setVoteKind] = useState<"Yes" | "No" | "Abstain">("Abstain");
  const { toast } = useToast();
  const setAlert = useSiteStore((state) => state.setAlert);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();

  async function vote() {
    if (drepInfo === undefined) {
      setAlert("DRep not found");
      toast({
        title: "DRep not found",
        description: `Please register as a DRep and retry.`,
        duration: 10000,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const [txHash, certIndex] = proposalId.split("#");
      if (txHash === undefined || certIndex === undefined) {
        setAlert("Invalid proposal ID format");
        setLoading(false);
        return;
      }

      const dRepId = appWallet.dRepId;
      const txBuilder = getTxBuilder(network);
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);

      const assetMap = new Map<Unit, Quantity>();
      assetMap.set("lovelace", "5000000");
      const selectedUtxos = keepRelevant(assetMap, utxos);

      for (const utxo of selectedUtxos) {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address
          )
          .txInScript(appWallet.scriptCbor);
      }
      console.log(certIndex)
      txBuilder
        .vote(
          {
            type: "DRep",
            drepId: dRepId,
          },
          {
            txHash: txHash,
            txIndex: parseInt(certIndex),
          },
          {
            voteKind: voteKind,
          }
        )
        .voteScript(appWallet.scriptCbor)
        .selectUtxosFrom(utxos)
        .changeAddress(appWallet.address);

      await newTransaction({
        txBuilder,
        description: `Vote: ${voteKind} - ${description}`,
        metadataValue: metadata ? { label: "674", value: metadata } : undefined,
      });

      toast({
        title: "Transaction Successful",
        description: `Your vote (${voteKind}) has been recorded.`,
        duration: 5000,
      });

      setAlert("Vote transaction successfully created!");
    } catch (error) {
      if (error instanceof Error && error.message.includes("User rejected transaction")) {
        toast({
          title: "Transaction Aborted",
          description: "You canceled the vote transaction.",
          duration: 5000,
        });
      } else {
        toast({
          title: "Transaction Failed",
          description: `Error: ${error}`,
          duration: 10000,
          action: (
            <ToastAction
              altText="Copy error"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(error));
                toast({
                  title: "Error Copied",
                  description: "Error details copied to clipboard.",
                  duration: 5000,
                });
              }}
            >
              Copy Error
            </ToastAction>
          ),
          variant: "destructive",
        });
        console.error("Transaction error:", error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
<div className="flex flex-col items-center justify-center w-full max-w-sm space-y-2">
  <Select
    value={voteKind}
    onValueChange={(value) => setVoteKind(value as "Yes" | "No" | "Abstain")}
  >
    <SelectTrigger className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500">
      <SelectValue placeholder="Select Vote Kind" />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectItem value="Yes">Yes</SelectItem>
        <SelectItem value="No">No</SelectItem>
        <SelectItem value="Abstain">Abstain</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>

  <Button
    onClick={vote}
    disabled={loading || proposalId.length !== 66}
    className="w-full px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md shadow"
  >
    {loading ? "Voting..." : "Vote"}
  </Button>
</div>
  );
}