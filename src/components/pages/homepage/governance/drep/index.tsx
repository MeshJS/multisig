import React, { useEffect, useState } from "react";
import SectionTitle from "@/components/common/section-title";
import Pagination from "@/components/common/overall-layout/pagination";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { BlockfrostDrepInfo, BlockfrostDrepMetadata } from "@/types/governance";
import Link from "next/link";
import { useWallet } from "@meshsdk/react";
import DelegateButton from "./id/delegateButton";
import RowLabelInfo from "@/components/common/row-label-info";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export default function DrepOverviewPage() {
  const [drepList, setDrepList] = useState<
    Array<{ details: BlockfrostDrepInfo; metadata: BlockfrostDrepMetadata }>
  >([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { wallet, connected } = useWallet();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [isLastPage, setIsLastPage] = useState<boolean>(false);
  const [network, setNetwork] = useState<number>(1); // Default to mainnet

  useEffect(() => {
    async function loadDrepList() {
      const blockchainProvider = getProvider(network);
      setLoading(true);
      try {
        const response = await blockchainProvider.get(
          `/governance/dreps/?count=${pageSize}&page=${currentPage}&order=${order}`,
        );

        if (response) {
          const initialList = response.map((drep: BlockfrostDrepInfo) => ({
            details: {
              drep_id: drep.drep_id,
              hex: null,
              amount: null,
              active: null,
              active_epoch: null,
              has_script: null,
            },
            metadata: {},
          }));

          setDrepList(initialList);
          response.forEach((drep: BlockfrostDrepInfo) =>
            fetchDrepDetails(drep.drep_id),
          );

          setIsLastPage(response.length < pageSize);
        } else {
          console.error("Unexpected API response format:", response);
        }
      } catch (error) {
        console.error("Error loading DREP list:", error);
      } finally {
        setLoading(false);
      }
    }

    loadDrepList();
  }, [currentPage, pageSize, order, wallet]);

  // Fetch DRep details
  const fetchDrepDetails = async (drepId: string) => {
    const blockchainProvider = getProvider(network);
    try {
      const details: BlockfrostDrepInfo = await blockchainProvider.get(
        `/governance/dreps/${drepId}`,
      );
      const metadata: BlockfrostDrepMetadata = await blockchainProvider.get(
        `/governance/dreps/${drepId}/metadata/`,
      );

      setDrepList((prevList) =>
        prevList.map((drep) =>
          drep.details.drep_id === drepId ? { details, metadata } : drep,
        ),
      );
    } catch (error) {
      console.error(`Failed to fetch details for DREP ${drepId}:`, error);
    }
  };

  return (
    <TooltipProvider>
      <main className="flex flex-col gap-8 p-4 md:p-8 text-gray-300">
        <SectionTitle>DREP Overview</SectionTitle>

        {/* Pagination Component */}
        <Pagination
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          order={order}
          setOrder={setOrder}
          onLastPage={isLastPage}
        />

        {/* DRep List */}
        <div className="flex flex-col gap-4">
          {loading ? (
            <p>Loading DREP information...</p>
          ) : (
            drepList.map(({ details, metadata }) => {
              const drepId = details.drep_id;
              const givenName =
                typeof metadata?.json_metadata?.body?.givenName === "object"
                  ? metadata.json_metadata.body.givenName["@value"] ||
                    "Unknown Name"
                  : metadata?.json_metadata?.body?.givenName || "Unknown Name";
              const isActive = details?.active ?? false;
              const imageUrl =
                metadata?.json_metadata?.body?.image?.contentUrl || null;
              const adaAmount = details?.amount
                ? (parseInt(details.amount, 10) / 1_000_000).toFixed(2) + " ₳"
                : "";
              const isScript = details?.has_script ? "Yes" : "No";

              return (
                <div
                key={drepId}
                className="flex items-center gap-4 rounded-lg border-y border-gray-700 p-4 shadow-sm"
              >
                {/* Profile Image or Placeholder */}
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={givenName}
                    className="h-12 w-12 rounded-full object-cover"
                  />
                ) : (
                  <svg
                    className="h-12 w-12 text-gray-500"
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
              
                {/* DRep Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {/* Status Indicator with Tooltip */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`h-3 w-3 rounded-full ${
                            isActive ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {isActive
                          ? "This DRep is currently active in governance."
                          : "This DRep is inactive."}
                      </TooltipContent>
                    </Tooltip>
              
                    {/* DRep Name */}
                    <Link href={`/governance/drep/${drepId}`} passHref>
                      <div className="cursor-pointer text-lg font-semibold hover:underline text-gray-200">
                        {givenName}
                      </div>
                    </Link>
              
                    {/* Script Indicator (only if `has_script` is true) */}
                    {isScript === "Yes" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <svg
                            className="h-5 w-5 text-blue-400"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M9 18v-6l-2 2m6 4v-6l2 2m4 4V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2z"></path>
                          </svg>
                        </TooltipTrigger>
                        <TooltipContent>
                          This DRep uses a script-based voting mechanism.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
              
                  {/* DRep ID directly under name */}
                  <RowLabelInfo
                    label="DRep ID:"
                    value={drepId}
                    copyString={drepId}
                    className="text-sm text-gray-400"
                  />
                </div>
              
                {/* ADA Amount (Larger, Aligned Right) */}
                <p className="text-lg font-semibold text-gray-300">{adaAmount}</p>
              
                {/* Delegate Button */}
                {details.amount && <DelegateButton drepid={drepId} />}
              </div>
              );
            })
          )}

          {!loading && drepList.length === 0 && (
            <p className="text-gray-500">No DREP information available.</p>
          )}
        </div>
      </main>
    </TooltipProvider>
  );
}