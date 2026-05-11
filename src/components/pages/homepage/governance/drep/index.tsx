import React, { useEffect, useMemo, useState } from "react";
import SectionTitle from "@/components/ui/section-title";
import Pagination from "@/components/common/overall-layout/pagination";
import { getProvider } from "@/utils/get-provider";
import { BlockfrostDrepInfo, BlockfrostDrepMetadata } from "@/types/governance";
import Link from "next/link";
import { useWallet } from "@meshsdk/react";
import DelegateButton from "./id/delegateButton";
import RowLabelInfo from "@/components/common/row-label-info";
import { TooltipProvider } from "@/components/ui/tooltip";
import ActiveIndicator from "./activeIndicator";
import ScriptIndicator from "./scriptIndicator";
import { Button } from "@/components/ui/button";

export default function DrepOverviewPage() {
  const [drepList, setDrepList] = useState<
    Array<{ details: BlockfrostDrepInfo; metadata: BlockfrostDrepMetadata | null }>
  >([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { wallet, connected } = useWallet();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [isLastPage, setIsLastPage] = useState<boolean>(false);
  const [network, setNetwork] = useState<number>(3); // Default to mainnet
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

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
    async function loadDrepList() {
      if (network === 3) return; // Prevent fetching if network is not set
  
      setLoading(true);
      const blockchainProvider = getProvider(network);
  
      try {
        const response = await blockchainProvider.get(
          `/governance/dreps/?count=${pageSize}&page=${currentPage}&order=${order}`,
        );
  
        if (response) {
          const initialList = response.map((drep: BlockfrostDrepInfo) => ({
            details: { ...drep },
            metadata: null,
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
  
    if (network !== null) {
      loadDrepList();
    }
  }, [currentPage, pageSize, order, network]); // Dependency now waits for network

  // Fetch DRep details
  const fetchDrepDetails = async (drepId: string) => {
    const blockchainProvider = getProvider(network);
    try {
      const details: BlockfrostDrepInfo = await blockchainProvider.get(
        `/governance/dreps/${drepId}`,
      );
      
      let metadata: BlockfrostDrepMetadata | null = null;
      try {
        metadata = await blockchainProvider.get(
          `/governance/dreps/${drepId}/metadata/`,
        );
      } catch (err: any) {
        // 404 is expected if metadata doesn't exist - silently ignore
        const is404 = err?.response?.status === 404 || err?.data?.status_code === 404;
        if (!is404) {
          console.warn(`Failed to fetch metadata for DRep ${drepId}:`, err);
        }
      }

      setDrepList((prevList) =>
        prevList.map((drep) =>
          drep.details.drep_id === drepId ? { details, metadata: metadata || null } : drep,
        ),
      );
    } catch (error: any) {
      const is404 = error?.response?.status === 404 || error?.data?.status_code === 404;
      if (!is404) {
        console.error(`Failed to fetch details for DREP ${drepId}:`, error);
      }
    }
  };

  const aggregate = useMemo(() => {
    let active = 0;
    let totalLovelace = 0;
    for (const { details } of drepList) {
      if (details?.active) active += 1;
      const amt = details?.amount ? parseInt(details.amount, 10) : 0;
      if (Number.isFinite(amt)) totalLovelace += amt;
    }
    return {
      total: drepList.length,
      active,
      inactive: drepList.length - active,
      totalAda: totalLovelace / 1_000_000,
    };
  }, [drepList]);

  const visibleDreps = useMemo(() => {
    if (filter === "all") return drepList;
    if (filter === "active") return drepList.filter((d) => d.details?.active);
    return drepList.filter((d) => !d.details?.active);
  }, [drepList, filter]);

  return (
    <TooltipProvider>
      <main className="flex flex-col gap-8 p-4 text-gray-300 md:p-8">
        <SectionTitle>DREP Overview</SectionTitle>

        {/* Aggregate stats for current page */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">On this page</div>
            <div className="mt-1 text-xl font-semibold text-foreground">
              {aggregate.total}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Active</div>
            <div className="mt-1 text-xl font-semibold text-foreground">
              {aggregate.active}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Inactive</div>
            <div className="mt-1 text-xl font-semibold text-foreground">
              {aggregate.inactive}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">ADA delegated</div>
            <div className="mt-1 text-xl font-semibold text-foreground">
              {aggregate.totalAda >= 1_000_000
                ? `${(aggregate.totalAda / 1_000_000).toFixed(2)}M ₳`
                : aggregate.totalAda >= 1_000
                  ? `${(aggregate.totalAda / 1_000).toFixed(1)}k ₳`
                  : `${aggregate.totalAda.toFixed(0)} ₳`}
            </div>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap gap-2">
          {(["all", "active", "inactive"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "secondary"}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "active" ? "Active" : "Inactive"}
            </Button>
          ))}
        </div>

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
            visibleDreps.map(({ details, metadata }) => {
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
              const isScript = details?.has_script;

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
                      <ActiveIndicator isActive={isActive} />
                      {/* DRep Name */}
                      <Link href={`/governance/drep/${drepId}`} passHref>
                        <div className="cursor-pointer text-lg font-semibold text-gray-200 hover:underline">
                          {givenName}
                        </div>
                      </Link>
                      {isScript && <ScriptIndicator hasScript={isScript} />}
                    </div>

                    {/* DRep ID directly under name */}
                    <RowLabelInfo
                      label="DRep ID:"
                      value={drepId}
                      copyString={drepId}
                      className="text-sm text-gray-400"
                    />
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      {details?.active_epoch != null && (
                        <span>Active since epoch {details.active_epoch}</span>
                      )}
                      {details?.hex && (
                        <span className="font-mono">hex: {details.hex.slice(0, 16)}…</span>
                      )}
                    </div>
                  </div>

                  {/* ADA Amount (Larger, Aligned Right) */}
                  <p className="text-lg font-semibold text-gray-300">
                    {adaAmount}
                  </p>

                  {/* Delegate Button */}
                  {details.amount && <DelegateButton drepid={drepId} />}
                </div>
              );
            })
          )}

          {!loading && drepList.length === 0 && (
            <p className="text-gray-500">No DREP information available.</p>
          )}
          {!loading && drepList.length > 0 && visibleDreps.length === 0 && (
            <p className="text-gray-500">
              No DReps match the {filter} filter on this page.
            </p>
          )}
        </div>
      </main>
    </TooltipProvider>
  );
}
