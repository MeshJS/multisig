import React, { useEffect, useState } from "react";
import SectionTitle from "@/components/common/section-title";
import CardUI from "@/components/common/card-content";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { BlockfrostDrepInfo } from "@/types/governance";
import { Button } from "@/components/ui/button";

export default function DrepOverviewPage() {
  const network = 0; // Ensure the correct network value is set
  const [drepList, setDrepList] = useState<BlockfrostDrepInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [totalPages, setTotalPages] = useState<number>(1);
  const blockchainProvider = getProvider(network);

  useEffect(() => {
    async function loadDrepList() {
      setLoading(true);
      try {
        const initialList = await blockchainProvider.get(`/governance/dreps/`);
        if (Array.isArray(initialList)) {
          const enrichedList = await Promise.all(
            initialList.map(async (drep: { drep_id: string; hex: string }) => {
              try {
                const details = await blockchainProvider.get(
                  `/governance/dreps/${drep.drep_id}`
                );
                return details;
              } catch (error) {
                console.error(
                  `Failed to fetch details for DREP ID: ${drep.drep_id}`,
                  error
                );
                return { ...drep, error: true }; // Mark this item as failed
              }
            })
          );
          setDrepList(enrichedList);
          setTotalPages(Math.ceil(enrichedList.length / pageSize));
        } else {
          console.error("Unexpected API response format:", initialList);
        }
      } catch (error) {
        console.error("Error loading DREP list:", error);
      } finally {
        setLoading(false);
      }
    }

    loadDrepList(); // Call the loader once
  }, [pageSize]);

  const startIndex = (currentPage - 1) * pageSize;
  const displayedDreps = drepList.slice(startIndex, startIndex + pageSize);

  return (
    <main className="flex flex-col gap-8 p-4 md:p-8">
      <SectionTitle>DREP Overview</SectionTitle>
      <p className="text-muted-foreground">
        Discover Delegated Representatives (DReps) in the Cardano ecosystem.
        Each DRep empowers stakeholders by representing their votes in
        governance proposals. Browse the list to find active representatives
        and their contributions.
      </p>

      {loading && <p>Loading DREP information...</p>}

      {!loading && displayedDreps.length > 0 && (
        <div className="space-y-4">
          {displayedDreps.map((drep) => (
            <CardUI key={drep.drep_id} title={`DRep: ${drep.drep_id}`}>
              <ul className="list-none space-y-2 text-sm">
                <li>
                  <strong>Hex:</strong> {drep.hex}
                </li>
                {drep ? (
                  <>
                    <li>
                      <strong>Amount:</strong> {drep.amount}
                    </li>
                    <li>
                      <strong>Active:</strong> {drep.active ? "Yes" : "No"}
                    </li>
                    <li>
                      <strong>Active Epoch:</strong> {drep.active_epoch}
                    </li>
                    <li>
                      <strong>Has Script:</strong>{" "}
                      {drep.has_script ? "Yes" : "No"}
                    </li>
                  </>
                ) : (
                  <li style={{ color: "red" }}>
                    Failed to load additional details.
                  </li>
                )}
              </ul>
              <div className="mt-4">
                <Button
                  onClick={() =>
                    window.location.href = `/governance/drep/${drep.drep_id}`
                  }
                >
                  More Info
                </Button>
              </div>
            </CardUI>
          ))}
        </div>
      )}

      {!loading && displayedDreps.length === 0 && (
        <p>No DREP information available.</p>
      )}

      <div className="flex justify-between mt-6">
        <Button
          onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
          disabled={currentPage === 1}
        >
          Previous
        </Button>
        <Button
          onClick={() =>
            setCurrentPage((prev) => Math.min(prev + 1, totalPages))
          }
          disabled={currentPage === totalPages}
        >
          Next
        </Button>
      </div>
    </main>
  );
}