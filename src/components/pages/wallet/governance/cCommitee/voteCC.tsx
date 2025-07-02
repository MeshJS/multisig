import { useState, useEffect } from "react";
import CardUI from "@/components/ui/card-content";
import { Button } from "@/components/ui/button";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { useSiteStore } from "@/lib/zustand/site";
import { useRouter } from "next/router";
import sendDiscordMessage from "@/lib/discord/sendDiscordMessage";
import { api } from "@/utils/api";
import { getFile, hashDrepAnchor, UTxO } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import useTransaction from "@/hooks/useTransaction";
import { getProvider } from "@/utils/get-provider";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { getDRepIds } from "@meshsdk/core-cst";

const candidates = [
  { id: "2", name: "Emurgone" },
  { id: "3", name: "Waldo" },
  { id: "4", name: "Kevin G Mohr" },
  { id: "5", name: "Tingvard" },
  { id: "6", name: "Cardano Constitutional Consortium" },
  { id: "9", name: "Quality of Life World Foundation" },
  { id: "11", name: "Cardano Lover" },
  { id: "12", name: "FutureProduct LLC dba Futurism Products" },
  { id: "13", name: "Cardano Atlantic Council" },
  { id: "14", name: "Cardano Ethical Oversight (CEO)" },
  { id: "15", name: "KtorZ" },
  { id: "16", name: "phil_uplc" },
  { id: "17", name: "Eastern Cardano Council" },
  { id: "18", name: "Adara Consortium" },
  { id: "19", name: "Cardano Japan Council" },
  { id: "20", name: "Wanchain" },
  { id: "21", name: "STORM Partners" },
  { id: "22", name: "SIDAN Lab" },
  { id: "23", name: "Ace Alliance" },
];

export default function VoteCC({
  manualUtxos,
  manualSelected,
  appWallet,
  network,
}: {
  manualUtxos: UTxO[];
  manualSelected: boolean;
  appWallet: any;
  network: number;
}) {
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [anchorUrl, setAnchorUrl] = useState<string>("");
  const [showAnchorInput, setShowAnchorInput] = useState<boolean>(false);
  const { connected } = useWallet();
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();
  const toggleCandidate = (id: string) => {
    if (selectedCandidates.includes(id)) {
      setSelectedCandidates((prev) => prev.filter((c) => c !== id));
    } else if (selectedCandidates.length < 7) {
      setSelectedCandidates((prev) => [...prev, id]);
    }
  };

  const hasReachedLimit = selectedCandidates.length >= 7;

  // appWallet and network are now passed in as props
  const setLoading = useSiteStore((state) => state.setLoading);
  const loading = useSiteStore((state) => state.loading);
  const router = useRouter();

  const { data: discordData } = api.user.getDiscordIds.useQuery({
    addresses: appWallet?.signersAddresses ?? [],
  });

  const discordIds = Object.values(discordData ?? {}).filter(Boolean);

  useEffect(() => {
    if (!connected || !appWallet) return;

    async function lookupAnchor() {
      try {
        const blockchainProvider = getProvider(network);
        const dRepId = getDRepIds(appWallet.dRepId);
        const drepMetadata = await blockchainProvider.get(
          `/governance/dreps/${dRepId.cip105}/metadata`
        );
        setAnchorUrl(drepMetadata.url);
      } catch (e: any) {
          setShowAnchorInput(true);
      }
    }

    lookupAnchor();
  }, [connected, appWallet, network]);

  async function submitCCVote() {
    if (!connected) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if(!multisigWallet) throw new Error("Multisig wallet not found");
    if (!anchorUrl) throw new Error("Anchor URL missing");
    const fileContent = getFile(anchorUrl);
    const anchorObj = JSON.parse(fileContent);
    const anchorHash = hashDrepAnchor(anchorObj);

    setLoading(true);
    try {
      const txBuilder = getTxBuilder(network);
      const paymentScript = appWallet.scriptCbor;
      if (!paymentScript) return;

      for (const utxo of manualUtxos) {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInScript(paymentScript);
      }

      txBuilder
        .drepUpdateCertificate(paymentScript, {
          anchorUrl,
          anchorDataHash: anchorHash,
        })
        .certificateScript(paymentScript)
        .changeAddress(appWallet.address)
        .metadataValue("11113", {
          data: {
            id: "2a9b76c3-9e84-4c4b-92bb-0184d4407f82",
            event: "CC-Elections-2025",
            votes: selectedCandidates.map((id) => Number(id)),
            network: "MAIN",
            category: "CATEGORY_E794",
            proposal: "0ae97786-d17b-4f96-84af-979ff9c0b276",
            walletType: "CARDANO",
          },
          action: "cast_vote",
        });


      await newTransaction({
        txBuilder,
        description: "CC Vote",
      });
      // send discord message
      await sendDiscordMessage(
        discordIds,
        `**NEW MULTISIG TRANSACTION:** A new CC Vote was created for your wallet: ${appWallet.name}. Review it here: ${window.location.origin}/wallets/${appWallet.id}/transactions`,
      );
      router.push(`/wallets/${appWallet.id}/transactions`);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }

  return (
    <CardUI
      title="Vote for Constitutional Committee"
      description="Only the first vote is counted. Hence resubmitting your vote will NOT overwrite your previous selection."
      cardClassName="col-span-2"
    >
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {selectedCandidates.length} / 7 selected
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-2.5 rounded-full bg-blue-500 dark:bg-blue-400 transition-all duration-300"
            style={{ width: `${(selectedCandidates.length / 7) * 100}%` }}
          ></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {candidates.map((candidate) => {
          const isSelected = selectedCandidates.includes(candidate.id);
          const isDisabled = hasReachedLimit && !isSelected;
          return (
            <div
              key={candidate.id}
              onClick={() => {
                if (!isDisabled) toggleCandidate(candidate.id);
              }}
              className={`cursor-pointer rounded border p-4 text-sm transition
                ${isSelected ? "border-blue-500 bg-blue-100 dark:bg-blue-900 dark:border-blue-400 font-semibold ring-2 ring-blue-400 dark:ring-blue-300 shadow-md" : ""}
                ${isDisabled ? "cursor-not-allowed opacity-50" : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:shadow"}`}
            >
              <div className="text-base font-medium text-gray-900 dark:text-gray-100">{candidate.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">ID: {candidate.id}</div>
            </div>
          );
        })}
      </div>
      {showAnchorInput && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Enter dRep Anchor URL
          </label>
          <input
            type="text"
            value={anchorUrl}
            onChange={(e) => setAnchorUrl(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2 text-sm"
            placeholder="https://..."
          />
        </div>
      )}
      {appWallet && (
        <div className="mt-6">
          <Button
            onClick={submitCCVote}
            disabled={
              loading ||
              selectedCandidates.length === 0 ||
              anchorUrl.trim() === ""
            }
          >
            Submit CC Vote
          </Button>
        </div>
      )}
      <div className="mt-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Selected Candidates</h3>
        <pre className="rounded bg-gray-100 dark:bg-gray-800 p-2 text-sm text-gray-800 dark:text-gray-100">
          {JSON.stringify(selectedCandidates, null, 2)}
        </pre>
        {hasReachedLimit && (
          <p className="mt-2 text-sm text-red-600">
            You can only select up to 7 candidates.
          </p>
        )}
      </div>
    </CardUI>
  );
}
