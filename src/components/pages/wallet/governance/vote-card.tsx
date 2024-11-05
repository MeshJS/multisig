import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import { useWalletsStore } from "@/lib/zustand/wallets";
import Button from "@/components/common/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import useTransaction from "@/hooks/useTransaction";
import { keepRelevant, Quantity, Unit } from "@meshsdk/core";

export default function VoteCard({ appWallet }: { appWallet: Wallet }) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const [proposalId, setProposalId] = useState<string>("");
  const [voteKind, setVoteKind] = useState<string>("Abstain");
  const [description, setDescription] = useState<string>("");
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();

  async function vote() {
    if (drepInfo === undefined) throw new Error("DRep not found");

    setLoading(true);

    const [txHash, certIndex] = proposalId.split("#");
    if (txHash === undefined || certIndex === undefined)
      throw new Error("Invalid proposal id");

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
          utxo.output.address,
        )
        .txInScript(appWallet.scriptCbor);
    }

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
          voteKind: voteKind as "Yes" | "No" | "Abstain",
        },
      )
      .voteScript(appWallet.scriptCbor)
      .selectUtxosFrom(utxos)
      .changeAddress(appWallet.address);

    await newTransaction({
      txBuilder,
      description: `Vote: ${voteKind} - ${description}`,
    });

    setLoading(false);
  }

  return (
    <CardUI title="Vote for proposal" description="" cardClassName="col-span-2">
      <fieldset className="grid gap-6">
        <div className="grid gap-3">
          <Label htmlFor="name">Proposal ID (i.e. hash#0)</Label>
          <Input
            id="name"
            type="text"
            className="w-full"
            placeholder="e.g. 7fd6429add8f2611ad8d48c0cc49101463093aec285faea402e8cfde78ea58d7#0"
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value)}
          />
        </div>
        <div className="grid gap-3">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            className="w-full"
            placeholder="what you are voting for"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-3">
          <Label htmlFor="type">Vote Action</Label>
          <Select
            value={voteKind}
            onValueChange={(value) => setVoteKind(value)}
            defaultValue={"Abstain"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="Abstain">Abstain</SelectItem>
                <SelectItem value="Yes">Yes</SelectItem>
                <SelectItem value="No">No</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-4">
          <Button onClick={() => vote()} disabled={loading}>
            {loading ? "Creating transaction..." : "Create Vote Transaction"}
          </Button>
        </div>
      </fieldset>
    </CardUI>
  );
}
