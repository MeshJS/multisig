import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import SectionTitle from "@/components/ui/section-title";
import { getProvider } from "@/utils/get-provider";
import { BlockfrostDrepInfo, BlockfrostDrepMetadata } from "@/types/governance";
import Metadata from "./metadata";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader } from "lucide-react";
import ActiveIndicator from "../activeIndicator";
import ScriptIndicator from "../scriptIndicator";
import { useWallet } from "@meshsdk/react";
import RowLabelInfo from "@/components/common/row-label-info";
import { extractJsonLdValue } from "@/utils/jsonLdParser";
import { Button } from "@/components/ui/button";
import DelegateButton from "./delegateButton";

export default function DrepDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { wallet, connected } = useWallet();
  const [drepInfo, setDrepInfo] = useState<BlockfrostDrepInfo | null>(null);
  const [drepMetadata, setDrepMetadata] =
    useState<BlockfrostDrepMetadata | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [network, setNetwork] = useState<number>(3); // Default to mainnet

    useEffect(() => {
      async function fetchNetwork() {
        if (connected && wallet) {
          try {
            const net = await wallet.getNetworkId();
            setNetwork(net);
          } catch (error) {
          setNetwork(1);
            console.error("Error fetching network ID:", error);
          }
        }
      }
    
      fetchNetwork();
    }, [connected, wallet]);
    
  useEffect(() => {
    if (network === 3) return; // Prevent fetching if network is not set
    if (id) fetchDrepData(id as string);
  }, [id, wallet, network]);

  async function fetchDrepData(drepId: string) {
    setLoading(true);
    try {
      const blockchainProvider = getProvider(network);
      const details = await blockchainProvider.get(
        `/governance/dreps/${drepId}`,
      );

      let metadata: BlockfrostDrepMetadata | null = null;
      try {
        metadata = await blockchainProvider.get(
          `/governance/dreps/${drepId}/metadata/`,
        );
      } catch {
        console.warn(`No metadata found for DRep ${drepId}`);
      }

      setDrepInfo(details || null);
      setDrepMetadata(metadata || null);
    } catch (error) {
      console.error(`Failed to fetch DRep ${drepId} details:`, error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!drepInfo) {
    return (
      <p className="text-center text-gray-500">DRep data is unavailable.</p>
    );
  }

  // Extract Data with JSON-LD Parsing
  const { drep_id, amount, active, has_script } = drepInfo;
  const givenName = extractJsonLdValue(
    drepMetadata?.json_metadata?.body?.givenName,
    "Unknown Name",
  );
  const imageUrl = drepMetadata?.json_metadata?.body?.image?.contentUrl || null;
  const adaAmount = amount
    ? (parseInt(amount, 10) / 1_000_000).toFixed(2) + " ₳"
    : "N/A";
  const paymentAddress = extractJsonLdValue(
    drepMetadata?.json_metadata?.body?.paymentAddress,
    "N/A",
  );

  return (
    <TooltipProvider>
      <main className="flex flex-col gap-4 p-4 text-gray-300 md:p-8">
        
        {/*  Top Action Buttons */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <Button variant="ghost" onClick={() => router.push("/governance/drep")}>
            ← Back to DRep List
          </Button>
          <DelegateButton drepid={drep_id} />
        </div>

        <SectionTitle>DRep Details</SectionTitle>

        {/* Layout: Profile Image + Details in a Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-4 items-start">
          {/* Profile Image */}
          <div className="flex-shrink-0">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={givenName}
                className="h-24 w-24 sm:h-32 sm:w-32 rounded-full object-cover"
              />
            ) : (
              <svg
                className="h-24 w-24 sm:h-32 sm:w-32 text-gray-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="7" r="4"></circle>
                <path d="M5 21c0-4 3-7 7-7s7 3 7 7"></path>
              </svg>
            )}
          </div>

          {/* Info Section */}
          <div className="flex flex-col space-y-2 min-w-0">
            {/* Name, Status, and Indicators */}
            <div className="flex flex-wrap items-center space-x-2">
              <ActiveIndicator isActive={active} />
              <span className="text-lg font-semibold text-gray-200">{givenName}</span>
              {has_script && <ScriptIndicator hasScript={has_script} />}
            </div>

            {/* DRep ID */}
            <RowLabelInfo
              label="DRep ID:"
              value={drep_id}
              copyString={drep_id}
              className="truncate sm:whitespace-nowrap break-all text-sm text-gray-400"
            />

            {/* Payment Address */}
            <RowLabelInfo
              label="Address:"
              value={paymentAddress}
              copyString={paymentAddress}
              className="truncate sm:whitespace-nowrap break-all text-sm text-gray-400"
            />
          </div>

          {/* ADA Amount */}
          <div className="flex-shrink-0 sm:text-right text-center w-full sm:w-auto">
            <p className="text-lg font-semibold text-gray-300">{adaAmount}</p>
          </div>
        </div>

        {/* Metadata Section */}
        <Metadata drepMetadata={drepMetadata} />
      </main>
    </TooltipProvider>
  );
}