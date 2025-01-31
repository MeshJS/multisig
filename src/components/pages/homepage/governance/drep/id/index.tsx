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
import DelegateButton from "./delegateButton"; // Import DelegateButton

export default function DrepLandingPage() {
  const { query, push } = useRouter();
  const { id: drepid } = query;
  const { wallet, connected } = useWallet();
  const { appWallet } = useAppWallet();
  const [drepInfo, setDrepInfo] = useState<BlockfrostDrepInfo | null>(null);
  const [drepMetadata, setDrepMetadata] = useState<DrepMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [network, setNetwork] = useState<number>(1); // Default to 1 (mainnet)

  useEffect(() => {
    if (!drepid || Array.isArray(drepid)) return;

    async function fetchDrepData() {
      setLoading(true);
      try {
        const networkId = await wallet.getNetworkId();
        setNetwork(networkId);
        const provider = getProvider(networkId);
        const [infoResult, metadataResult] = await Promise.allSettled([
          provider.get(`/governance/dreps/${drepid}`),
          provider.get(`/governance/dreps/${drepid}/metadata`),
        ]);

        if (infoResult.status === "fulfilled") {
          setDrepInfo(infoResult.value as BlockfrostDrepInfo);
        } else {
          console.error("Failed to fetch DRep info:", infoResult.reason);
        }

        if (metadataResult.status === "fulfilled") {
          setDrepMetadata(metadataResult.value as DrepMetadata);
        } else {
          console.error(
            "Failed to fetch DRep metadata:",
            metadataResult.reason,
          );
        }
      } catch (error) {
        console.error("Error fetching DRep data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchDrepData();
  }, [drepid, wallet]);

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!drepid || Array.isArray(drepid)) {
    return <p>Invalid DRep ID</p>;
  }

  return (
    <main className="flex flex-col gap-6 p-6 md:gap-8 md:p-12">
      {/* Header Section */}
      <div className="mb-6 flex items-center justify-between">
        <DelegateButton drepid={drepid as string} /> {/* Replace local function */}
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
      {drepInfo ? (
        <BaseData drepInfo={drepInfo} />
      ) : (
        <p>No DRep info available</p>
      )}
      {drepMetadata ? (
        <Metadata drepMetadata={drepMetadata} />
      ) : (
        <p>No metadata available</p>
      )}
    </main>
  );
}