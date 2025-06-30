import { useEffect, useState, useMemo } from "react";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";

export interface StakePool {
  pool_id: string;
  hex: string;
  active_stake: string;
  live_stake: string;
  blocks_minted: number;
  live_saturation: number;
  declared_pledge: string;
  margin_cost: number;
  fixed_cost: string;
  metadata: {
    url: string | null;
    hash: string | null;
    ticker: string | null;
    name: string | null;
    description: string | null;
    homepage: string | null;
  } | null;
}

export default function PoolSelector({
  onSelect,
}: {
  onSelect: (poolHex: string) => void;
}) {
  const network = useSiteStore((state) => state.network);

  const blockchainProvider = useMemo(() => {
    return getProvider(network);
  }, [network]);

  const [pools, setPools] = useState<StakePool[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const poolsPerPage = 100;

  useEffect(() => {
    if (!blockchainProvider) return;

    setLoading(true);

    blockchainProvider
      .get(`/pools/extended?page=${page}&count=${poolsPerPage}`)
      .then((data) => {
        setPools(data);
      })
      .catch((err) => {
        console.error("Error fetching pools:", err);
        setPools([]);
      })
      .finally(() => setLoading(false));
  }, [blockchainProvider, page]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Select Stake Pool</h2>

      {loading && <p>Loading pools...</p>}

      {!loading && pools.length === 0 && <p>No pools found.</p>}

      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {pools.map((pool) => (
            <div
              key={pool.hex}
              className="p-4 border rounded hover:shadow cursor-pointer transition-colors duration-200 bg-white hover:bg-gray-50 flex flex-col space-y-2"
              onClick={() => onSelect(pool.hex)}
            >
              <div className="flex justify-between items-center">
                <span className="text-base font-semibold text-gray-800">
                  {pool.metadata?.name || pool.pool_id.slice(0, 12) + "..."}
                </span>
                <span className="text-xs text-gray-500">
                  {pool.metadata?.ticker || "N/A"}
                </span>
              </div>
              <hr className="border-gray-200" />
              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>Live Stake:</span>
                  <span>₳ {(Number(pool.live_stake) / 1_000_000)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Saturation:</span>
                  <span>{(pool.live_saturation * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Margin:</span>
                  <span>{(pool.margin_cost * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Blocks Minted:</span>
                  <span>{pool.blocks_minted}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pledge:</span>
                  <span>₳ {(Number(pool.declared_pledge) / 1_000_000)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pools.length > 0 && (
        <div className="flex space-x-2 mt-4">
          <button
            disabled={page === 1}
            className="px-3 py-1 border rounded disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-sm">Page {page}</span>
          <button
            className="px-3 py-1 border rounded disabled:opacity-50"
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}