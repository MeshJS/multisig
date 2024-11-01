import CardUI from "@/components/common/card-content";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import RowLabelInfo from "@/components/common/row-label-info";
import { useSiteStore } from "@/lib/zustand/site";
import { ProposalMetadata } from "@/types/governance";
import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/common/button";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { useWalletsStore } from "@/lib/zustand/wallets";
import useAppWallet from "@/hooks/useAppWallet";
import useTransaction from "@/hooks/useTransaction";
import { Check, Loader } from "lucide-react";

export default function WalletGovernanceProposal({ id }: { id: string }) {
  const network = useSiteStore((state) => state.network);
  const [proposalMetadata, setProposalMetadata] = useState<
    ProposalMetadata | undefined
  >(undefined);
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const { appWallet } = useAppWallet();
  const { newTransaction } = useTransaction();
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);

  useEffect(() => {
    const blockchainProvider = getProvider(network);
    async function get() {
      const [txHash, certIndex] = id.split(":");
      const proposalData = await blockchainProvider.get(
        `/governance/proposals/${txHash}/${certIndex}/metadata`,
      );

      if (proposalData) {
        setProposalMetadata(proposalData);
      }
    }
    get();
  }, []);

  async function vote(voteKind: "Yes" | "No" | "Abstain") {
    if (drepInfo === undefined) throw new Error("DRep not found");
    if (appWallet === undefined) throw new Error("Wallet not found");
    if (proposalMetadata === undefined) throw new Error("Proposal not found");

    setLoading(true);

    const [txHash, certIndex] = id.split(":");
    if (txHash === undefined || certIndex === undefined)
      throw new Error("Invalid proposal id");

    const dRepId = drepInfo.drep_id;

    const txBuilder = getTxBuilder(network);
    const blockchainProvider = getProvider(network);
    const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);

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
        },
      )
      .selectUtxosFrom(utxos)
      .changeAddress(appWallet.address);

    await newTransaction({
      txBuilder,
      description: `Vote: ${voteKind} - ${proposalMetadata.json_metadata.body.title}`,
    });

    setLoading(false);
  }

  if (!proposalMetadata) return <></>;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <CardUI
        title={proposalMetadata.json_metadata.body.title}
        cardClassName="w-full"
        headerDom={
          network == 1 && (
            <div className="flex gap-4">
              <Button>
                <Link
                  href={`https://gov.tools/governance_actions/${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}
                  target="_blank"
                >
                  GOV TOOL
                </Link>
              </Button>
              <Button>
                <Link
                  href={`https://adastat.net/governances/${proposalMetadata.tx_hash}0${proposalMetadata.cert_index}`}
                  target="_blank"
                >
                  ADASTAT
                </Link>
              </Button>
            </div>
          )
        }
      >
        <RowLabelInfo
          label="Authors"
          value={proposalMetadata.json_metadata.authors
            .map((author: any) => author.name)
            .join(", ")}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Abstract"
          value={proposalMetadata.json_metadata.body.abstract}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Motivation"
          value={proposalMetadata.json_metadata.body.motivation}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Rationale"
          value={proposalMetadata.json_metadata.body.rationale}
          allowOverflow={true}
        />

        <div className="flex gap-4">
          <Button
            onClick={() => vote("Yes")}
            disabled={
              loading ||
              drepInfo === undefined ||
              appWallet === undefined ||
              proposalMetadata === undefined
            }
          >
            {loading && <Loader className="mr-2 h-4 w-4" />} Vote Yes
          </Button>
          <Button
            onClick={() => vote("No")}
            disabled={
              loading ||
              drepInfo === undefined ||
              appWallet === undefined ||
              proposalMetadata === undefined
            }
          >
            {loading && <Loader className="mr-2 h-4 w-4" />} Vote No
          </Button>
          <Button
            onClick={() => vote("Abstain")}
            disabled={
              loading ||
              drepInfo === undefined ||
              appWallet === undefined ||
              proposalMetadata === undefined
            }
          >
            {loading && <Loader className="mr-2 h-4 w-4" />} Vote Abstain
          </Button>
        </div>
      </CardUI>
    </main>
  );
}
