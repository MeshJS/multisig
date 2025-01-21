import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import BaseData from "./baseData";
import Metadata from "./metadata";
import { BlockfrostDrepInfo, DrepMetadata } from "@/types/governance";
import CardUI from "@/components/common/card-content";
import { useWallet } from "@meshsdk/react";
import useAppWallet from "@/hooks/useAppWallet";

export default function DrepLandingPage() {
  const { query, push } = useRouter();
  const { id: drepid } = query;
  const { wallet, connected } = useWallet();
  const { appWallet } = useAppWallet(); 
  const [drepInfo, setDrepInfo] = useState<BlockfrostDrepInfo | null>(null);
  const [drepMetadata, setDrepMetadata] = useState<DrepMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [network, setNetwork] = useState<number>(1); // Default to 1 (mainnet)
  const [delegating, setDelegating] = useState(false);

  useEffect(() => {
    async function fetchNetworkId() {
      if (connected && wallet) {
        try {
          const networkId = await wallet.getNetworkId();
          setNetwork(networkId);
        } catch (error) {
          console.error("Failed to fetch network ID:", error);
        }
      }
    }

    fetchNetworkId();
  }, [wallet, connected]);

  useEffect(() => {
    if (!drepid || Array.isArray(drepid)) return;

    async function fetchDrepData() {
      setLoading(true);
      try {
        const provider = getProvider(network);
        const [infoResult, metadataResult] = await Promise.allSettled([
          provider.get(`/governance/dreps/${drepid}`) as Promise<BlockfrostDrepInfo>,
          provider.get(`/governance/dreps/${drepid}/metadata`) as Promise<DrepMetadata>,
        ]);
        
        if (infoResult.status === "fulfilled") {
          setDrepInfo(infoResult.value);
        }
        if (metadataResult.status === "fulfilled") {
          setDrepMetadata(metadataResult.value);
        }
      } catch (error) {
        console.error("Failed to fetch DRep data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchDrepData();
  }, [drepid, network]);

  async function handleDelegate() {
    if (!drepid || Array.isArray(drepid)) return;
    console.log(drepid.length)
    if (!connected || !wallet) {
      alert("Please connect your wallet to delegate.");
      return;
    }

    setDelegating(true);
    try {
      const utxos = await wallet.getUtxos();

      const rewardAddresses = await wallet.getRewardAddresses();
      const rewardAddress = (appWallet)? appWallet.address : rewardAddresses[0];
      if (!rewardAddress) throw new Error("No reward address found.");

      const changeAddress = (appWallet)? appWallet.address : await wallet.getChangeAddress()
      

      const txBuilder = getTxBuilder(network);
      txBuilder
        .voteDelegationCertificate({ dRepId: drepid }, rewardAddress)
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxos)

      //ToDo handle multisig delegation correctly
    
      const unsignedTx = await txBuilder.complete();
      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);

      alert(`Delegation successful! Transaction hash: ${txHash}`);
    } catch (error) {
      console.error("Delegation failed:", error);
      alert("Failed to delegate. Please try again.");
    } finally {
      setDelegating(false);
    }
  }

  if (!drepid || Array.isArray(drepid)) {
    return <p>Invalid DRep ID</p>;
  }

  if (loading) {
    return <p>Loading...</p>;
  }

  return (
    <main className="flex flex-col gap-6 p-6 md:gap-8 md:p-12">
      {/* Header Section */}
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={handleDelegate}
          disabled={delegating || !connected}
          className={`rounded-md px-6 py-3 text-sm font-semibold ${
            delegating
              ? "cursor-not-allowed bg-gray-400 text-white"
              : connected
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "cursor-not-allowed bg-gray-300 text-gray-500"
          }`}
        >
          {delegating ? "Delegating..." : "Delegate"}
        </button>
        <h1 className="text-2xl font-bold text-gray-800">DRep Details</h1>
        <button
          onClick={() => push("/governance/drep")}
          className="rounded border bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
        >
          Back to DRep List
        </button>
      </div>

      {/* Explainer Card */}
      <CardUI
        title="How Voting Delegation Works"
        description="Delegating your voting power to a DRep (Delegated Representative)
    allows them to vote on your behalf in governance decisions. This
    ensures your voice is represented without requiring direct voting
    participation."
      >
        {!connected && (
          <p className="mt-2 text-sm text-red-500">
            Please connect your wallet to enable delegation.
          </p>
        )}
      </CardUI>

      {/* DRep Data Sections */}
      {drepMetadata && <Metadata drepMetadata={drepMetadata} />}
      {drepInfo && <BaseData drepInfo={drepInfo} />}

      {/* No Data Fallback */}
      {!drepInfo && !drepMetadata && (
        <p className="text-gray-500">No data available for this DRep.</p>
      )}
    </main>
  );
}
