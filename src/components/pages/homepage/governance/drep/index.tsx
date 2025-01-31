import React, { useEffect, useState } from "react";
import SectionTitle from "@/components/common/section-title";
import CardUI from "@/components/common/card-content";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { BlockfrostDrepInfo } from "@/types/governance";
import { Button } from "@/components/ui/button";
import BaseData from "./id/baseData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { useWallet } from "@meshsdk/react";
import DelegateButton from "./id/delegateButton";

export default function DrepOverviewPage() {
  const [drepList, setDrepList] = useState<BlockfrostDrepInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { wallet, connected } = useWallet();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [network, setNetwork] = useState<number>(1); // Default to 1 (mainnet)

  // Fetch the paginated list of DReps
  useEffect(() => {
    async function loadDrepList() {
      const blockchainProvider = getProvider(network);
      setLoading(true);
      try {
        const response = await blockchainProvider.get(
          `/governance/dreps/?count=${pageSize}&page=${currentPage}&order=asc`,
        );
        if (response) {
          // Initialize the list with basic DRep information
          const initialList = response.map((drep:BlockfrostDrepInfo) => ({
            drep_id: drep.drep_id,
            hex: null,
            amount: null,
            active: null,
            active_epoch: null,
            has_script: null,
          }));

          setDrepList(initialList);

          // Fetch details for each DRep
          response.forEach((drep: BlockfrostDrepInfo) =>
            fetchDrepDetails(drep.drep_id),
          );

          setTotalPages(Math.ceil(response.total_count / pageSize)); // Calculate total pages
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
  }, [currentPage, pageSize, wallet]);

  // Fetch details for a specific DRep
  const fetchDrepDetails = async (drepId: string) => {
    const blockchainProvider = getProvider(network);
    try {
      const details:BlockfrostDrepInfo = await blockchainProvider.get(
        `/governance/dreps/${drepId}`,
      );
      //console.log(drepList.map((m: BlockfrostDrepInfo) => (m.drep_id === drepId)? details : m ));
      setDrepList((prevList) =>
        prevList.map((drep) => (drep.drep_id === drepId ? details : drep)),
      );
    } catch (error) {
      console.error(`Failed to fetch details for DREP ID ${drepId}:`, error);
    }
  };

  return (
    <main className="flex flex-col gap-8 p-4 md:p-8">
      <SectionTitle>DREP Overview</SectionTitle>
      {/* Pagination and Page Size Dropdown */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <Button
            onClick={() =>
              setCurrentPage((prev) => Math.min(prev + 1, totalPages))
            }
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
        </div>

        <Select
          onValueChange={(value) => {
            setPageSize(Number(value));
            setCurrentPage(1); // Reset to first page when page size changes
          }}
          defaultValue="10"
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Page Size" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="20">20</SelectItem>
            <SelectItem value="30">30</SelectItem>
            <SelectItem value="40">40</SelectItem>
            <SelectItem value="50">50</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Responsive Grid Layout */}
      {loading ? (
        <p>Loading DREP information...</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {drepList.map((d: BlockfrostDrepInfo) => (
            <div>
        
            <Link
              key={d.drep_id}
              href={`/governance/drep/${d.drep_id}`}
              passHref
            >
              <div>
                {d.hex ? (
                  <BaseData drepInfo={d} />
                ) : (
                  <CardUI title={`DRep: ${d.drep_id}`}>
                    <p>Loading details...</p>
                  </CardUI>
                )}
              </div>
              
            </Link>
            <DelegateButton drepid={d.drep_id} />
            </div>
              
          ))}
        </div>
      )}

      {!loading && drepList.length === 0 && (
        <p>No DREP information available.</p>
      )}
    </main>
  );
}
