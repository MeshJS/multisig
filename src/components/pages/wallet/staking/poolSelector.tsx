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
        // auto-fill sizes columns from the container, not the viewport —
        // viewport breakpoints over-split the grid inside width-capped
        // dialogs (sm:max-w-4xl) on large screens.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
          {pools.map((pool) => (
            <div
              key={pool.hex}
              className="flex cursor-pointer flex-col space-y-2 rounded border border-border/60 bg-card/60 p-4 transition-colors duration-200 hover:bg-muted/50 hover:shadow"
              onClick={() => onSelect(pool.hex)}
            >
              <div className="flex items-start justify-between gap-2">
                {/* min-w-0 lets the flex item shrink below its content size so
                    long unbroken pool names wrap inside the card instead of
                    overflowing it; break-words handles names with no spaces. */}
                <span className="min-w-0 break-words text-base font-semibold text-foreground">
                  {pool.metadata?.name || pool.pool_id.slice(0, 12) + "..."}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {pool.metadata?.ticker || "N/A"}
                </span>
              </div>
              <hr className="border-border/60" />
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <span className="shrink-0">Live Stake:</span>
                  <span className="text-right">
                    ₳ {(Number(pool.live_stake) / 1_000_000)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="shrink-0">Saturation:</span>
                  <span className="text-right">
                    {(pool.live_saturation * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="shrink-0">Margin:</span>
                  <span className="text-right">
                    {(pool.margin_cost * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="shrink-0">Blocks Minted:</span>
                  <span className="text-right">{pool.blocks_minted}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="shrink-0">Pledge:</span>
                  <span className="text-right">
                    ₳ {(Number(pool.declared_pledge) / 1_000_000)}
                  </span>
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