import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  getNodesBounds,
  Panel,
  ReactFlow,
  useNodesInitialized,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useStore,
  ViewportPortal,
} from "@xyflow/react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
} from "lucide-react";

import "@xyflow/react/dist/style.css";

import type { TxFlowData } from "@/types/blockfrost";
import type { AddressLabeler } from "@/types/token-flow";
import type { Wallet } from "@/types/wallet";
import useAddressLabels from "@/hooks/useAddressLabels";
import { fetchTxFlowData } from "@/hooks/useTxFlowData";
import { useTxGovernanceBadges } from "@/hooks/useTxGovernanceBadges";
import { useSiteStore } from "@/lib/zustand/site";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { cn } from "@/lib/utils";
import { getProvider } from "@/utils/get-provider";
import {
  focusColumnRange,
  focusPair,
  mergeTokenFlows,
  onChainTxToTokenFlow,
  orderTimelineTxs,
  storeTxToTokenFlow,
  timelineTxNodeId,
  type TimelineTxRef,
} from "@/utils/token-flow";
import {
  CANVAS_BUTTON_CLASS,
  EDGE_TYPES,
  GLASS_PANEL_CLASS,
  NODE_TYPES,
  ResetLayoutButton,
} from "./flow-canvas";
import {
  layoutTokenFlow,
  TIMELINE_COLUMN_WIDTH,
  TIMELINE_LANE_OFFSET,
} from "./layout";

/**
 * Linked multi-transaction timeline: the wallet's on-chain transactions
 * merged into one flow graph, laid out chronologically (oldest left, newest
 * right) with shared addresses joining consecutive transactions.
 *
 * Rendering is two-tier: refs carrying store-held `utxos` draw immediately
 * with no network round-trip, then upgrade in place (fees, protocol edges,
 * per-UTxO ports) as the Blockfrost detail arrives. Detail is fetched
 * **only for transactions in (or near) the viewport** — the controller
 * reports visible tx columns after every pan/step/zoom, and those txs are
 * enriched in small paced batches (Blockfrost 429s the client-direct key
 * on bursts, so the next batch starts only after the previous settles,
 * plus a short breather). Off-screen history keeps its store-data
 * rendering until scrolled to; everything fetched stays cached forever.
 *
 * Unlike FlowCanvas this never auto-fits the whole graph: the viewport is
 * fitted once to the two newest transactions and then only moves when the
 * user pans or steps with the ◀ ▶ buttons, so detail loading never
 * disturbs it.
 */

/** Detail-fetch batch size (each tx costs 2+ Blockfrost requests). */
const DEFAULT_BATCH_SIZE = 3;
/** Breather between detail-fetch batches, for the rate limiter's sake. */
const BATCH_DELAY_MS = 500;
/** Columns beyond the viewport edges that still count as "in view", so
 *  stepping to a neighbour usually lands on already-enriched cards. */
const VISIBLE_BUFFER_COLUMNS = 4;
/** Vertical overshoot of the event divider lines past the content bounds. */
const DIVIDER_MARGIN = 20;

export type TokenFlowTimelineProps = {
  /** Transactions to include; any order — sorted chronologically inside. */
  txs: TimelineTxRef[];
  appWallet?: Wallet;
  /** Overrides the site-store network (0 = preprod, 1 = mainnet) so callers
   *  outside the wallet app (e.g. the marketing demo) can pin one. */
  network?: number;
  /** Overrides useAddressLabels(appWallet), for callers without a wallet. */
  labelAddress?: AddressLabeler;
  className?: string;
  /** Disambiguates testids from per-tx canvases rendering the same nodes. */
  testIdSuffix?: string;
  batchSize?: number;
  "data-testid"?: string;
};

/**
 * Fits the viewport to the 1-2 transactions in focus and drives the ◀ ▶
 * step navigation. Must live inside ReactFlow (uses useReactFlow); tracks
 * focus by tx node id so background-loading older txs (which prepend to the
 * loaded list) never shifts the current focus.
 */
function TimelineViewportController({
  orderedLoadedTxIds,
  txLayer,
  testIdSuffix,
  onVisibleTxs,
}: {
  orderedLoadedTxIds: string[];
  txLayer: Map<string, number>;
  testIdSuffix: string;
  /** Reports tx node ids in (or near) the viewport after every move. */
  onVisibleTxs: (txNodeIds: string[]) => void;
}) {
  const { fitBounds, getNodes, getViewport } = useReactFlow();
  const canvasWidth = useStore((state) => state.width);
  const nodesInitialized = useNodesInitialized();
  const [focusTxId, setFocusTxId] = useState<string | undefined>(undefined);
  const hasFittedRef = useRef(false);

  // Which tx columns intersect the viewport (in world coordinates), plus a
  // buffer so neighbours pre-enrich before the user steps to them.
  const reportVisible = useCallback(() => {
    if (canvasWidth <= 0) return;
    const { x, zoom } = getViewport();
    if (zoom <= 0) return;
    const minCol = -x / zoom / TIMELINE_COLUMN_WIDTH - VISIBLE_BUFFER_COLUMNS;
    const maxCol =
      (canvasWidth - x) / zoom / TIMELINE_COLUMN_WIDTH + VISIBLE_BUFFER_COLUMNS;
    const visible: string[] = [];
    for (const [txId, layer] of txLayer) {
      const col = 2 * layer + 1;
      if (col >= minCol && col <= maxCol) visible.push(txId);
    }
    if (visible.length > 0) onVisibleTxs(visible);
  }, [canvasWidth, getViewport, txLayer, onVisibleTxs]);

  useOnViewportChange({ onEnd: reportVisible });

  const fitToFocus = useCallback(
    (txId: string, duration: number) => {
      const index = orderedLoadedTxIds.indexOf(txId);
      if (index < 0) return;
      const range = focusColumnRange(
        txLayer,
        focusPair(orderedLoadedTxIds, index),
      );
      if (!range) return;
      // Widened by the lane offset so boundary cards shifted out of the
      // band's edge columns still count toward the fitted bounds.
      const minX = range.minCol * TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET - 1;
      const maxX = range.maxCol * TIMELINE_COLUMN_WIDTH + TIMELINE_LANE_OFFSET + 1;
      const band = getNodes().filter(
        (node) => node.position.x >= minX && node.position.x <= maxX,
      );
      if (band.length === 0) return;
      void fitBounds(getNodesBounds(band), { padding: 0.15, duration });
      // Belt and braces: viewport-change onEnd covers user gestures, but
      // programmatic fits report explicitly once the move has finished.
      window.setTimeout(reportVisible, duration + 50);
    },
    [orderedLoadedTxIds, txLayer, fitBounds, getNodes, reportVisible],
  );

  // Initial fit: once, as soon as the first (newest) transactions are
  // loaded and measured. Later data arrivals never re-trigger it.
  useEffect(() => {
    if (hasFittedRef.current || !nodesInitialized) return;
    const newest = orderedLoadedTxIds[orderedLoadedTxIds.length - 1];
    if (!newest) return;
    hasFittedRef.current = true;
    setFocusTxId(newest);
    window.requestAnimationFrame(() => fitToFocus(newest, 0));
  }, [nodesInitialized, orderedLoadedTxIds, fitToFocus]);

  const focusIndex = focusTxId ? orderedLoadedTxIds.indexOf(focusTxId) : -1;
  const step = (direction: -1 | 1) => {
    const next = orderedLoadedTxIds[focusIndex + direction];
    if (!next) return;
    setFocusTxId(next);
    fitToFocus(next, 300);
  };

  if (orderedLoadedTxIds.length < 2) return null;
  return (
    <Panel position="bottom-center">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid={`tx-flow-timeline-prev${testIdSuffix}`}
          title="Earlier transaction"
          // At index 1 the pair already includes the oldest loaded tx.
          disabled={focusIndex <= 1}
          onClick={() => step(-1)}
          className={cn(CANVAS_BUTTON_CLASS, "disabled:opacity-40")}
        >
          <ChevronLeft className="h-3 w-3" />
          Earlier
        </button>
        <button
          type="button"
          data-testid={`tx-flow-timeline-next${testIdSuffix}`}
          title="Later transaction"
          disabled={focusIndex < 0 || focusIndex >= orderedLoadedTxIds.length - 1}
          onClick={() => step(1)}
          className={cn(CANVAS_BUTTON_CLASS, "disabled:opacity-40")}
        >
          Later
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </Panel>
  );
}

export default function TimelineCanvas({
  txs,
  appWallet,
  network: networkProp,
  labelAddress: labelAddressProp,
  className,
  testIdSuffix = "-timeline",
  batchSize = DEFAULT_BATCH_SIZE,
  "data-testid": dataTestId,
}: TokenFlowTimelineProps) {
  const siteNetwork = useSiteStore((state) => state.network);
  const network = networkProp ?? siteNetwork;
  const { labelAddress: walletLabelAddress } = useAddressLabels(appWallet);
  const labelAddress = labelAddressProp ?? walletLabelAddress;
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );
  const [expanded, setExpanded] = useState(false);
  // Detail-fetch demand model: `wanted` holds tx hashes reported visible by
  // the viewport controller (never shrinks — fetched data is cached
  // forever anyway); `active` is the paced subset whose queries actually
  // run. Off-screen txs are never fetched.
  const [wanted, setWanted] = useState<string[]>([]);
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());

  const ordered = useMemo(() => orderTimelineTxs(txs), [txs]);
  const newestFirst = useMemo(() => [...ordered].reverse(), [ordered]);
  const timelineTxHashes = useMemo(
    () => ordered.map((ref) => ref.txHash),
    [ordered],
  );
  // Per-tx governance activity (votes, DRep/committee certs) joined in as
  // extra badges — Blockfrost's per-tx endpoints don't expose these, and a
  // known-DRep-id lookup would miss per-run DReps (see the hook docs).
  const govBadgesByTx = useTxGovernanceBadges({
    txHashes: timelineTxHashes,
    network,
  });

  const handleVisibleTxs = useCallback((txNodeIds: string[]) => {
    // Node ids are `tx:<hash>` (timelineTxNodeId).
    const hashes = txNodeIds.map((id) => id.slice(3));
    setWanted((current) => {
      const fresh = hashes.filter((hash) => !current.includes(hash));
      return fresh.length === 0 ? current : [...current, ...fresh];
    });
  }, []);

  // Hash-only callers (no store utxos) render nothing until a fetch lands,
  // so the controller never mounts to report visibility — seed the newest
  // batch to break the deadlock. Store-backed refs don't need this.
  useEffect(() => {
    if (wanted.length > 0 || ordered.some((ref) => ref.utxos)) return;
    handleVisibleTxs(
      newestFirst.slice(0, batchSize).map((ref) => timelineTxNodeId(ref.txHash)),
    );
  }, [wanted.length, ordered, newestFirst, batchSize, handleVisibleTxs]);

  // Same query keys/config as useTxFlowData, so the cache is shared with
  // every per-tx viz surface.
  const queries = useQueries({
    queries: newestFirst.map((ref) => ({
      queryKey: ["tx-flow", network, ref.txHash],
      queryFn: () => fetchTxFlowData(getProvider(network), ref.txHash),
      enabled: active.has(ref.txHash),
      staleTime: Infinity,
      gcTime: Infinity,
      // Default exponential backoff between attempts rides out 429s.
      retry: 2,
    })),
  });
  // Promote wanted → active in small batches, the next only after the
  // current settles plus a breather — keeps the client-direct Blockfrost
  // key under its rate limit even if the user zooms out over everything.
  const settledStamp = queries.map((query) => query.isFetched).join(",");
  useEffect(() => {
    const indexByHash = new Map(newestFirst.map((ref, i) => [ref.txHash, i]));
    const unsettled = [...active].some((hash) => {
      const index = indexByHash.get(hash);
      return index !== undefined && !queries[index]!.isFetched;
    });
    if (unsettled) return;
    const next = wanted
      .filter((hash) => !active.has(hash) && indexByHash.has(hash))
      .slice(0, batchSize);
    if (next.length === 0) return;
    const timer = setTimeout(
      () => setActive((current) => new Set([...current, ...next])),
      BATCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, active, batchSize, newestFirst, settledStamp]);

  // Stable-size dependency: stamps change whenever any query resolves.
  const dataStamp = queries.map((query) => query.dataUpdatedAt).join(",");
  const { layoutNodes, edges, txLayer, presentTxIds, dividers, bounds } =
    useMemo(() => {
      const detailByHash = new Map<string, TxFlowData>();
      newestFirst.forEach((ref, index) => {
        const data = queries[index]?.data as TxFlowData | undefined;
        if (data) detailByHash.set(ref.txHash, data);
      });
      // Full flow when the detail fetch has landed, store-data fallback
      // otherwise — identical node ids, so the upgrade is seamless.
      const present: string[] = [];
      const flows = ordered.flatMap((ref) => {
        const detail = detailByHash.get(ref.txHash);
        const extraBadges = govBadgesByTx.get(ref.txHash.toLowerCase());
        if (detail) {
          present.push(timelineTxNodeId(ref.txHash));
          return [
            onChainTxToTokenFlow(detail, {
              labelAddress,
              description: ref.description ?? undefined,
              extraBadges,
            }),
          ];
        }
        if (!ref.utxos) return [];
        present.push(timelineTxNodeId(ref.txHash));
        return [storeTxToTokenFlow(ref, { labelAddress, extraBadges })];
      });
      const layout = layoutTokenFlow(mergeTokenFlows(flows), {
        txOrder: ordered.map((ref) => timelineTxNodeId(ref.txHash)),
        testIdSuffix,
      });
      return {
        layoutNodes: layout.nodes,
        edges: layout.edges.map((edge) => ({
          ...edge,
          data: { ...edge.data, assetMetadata: walletAssetMetadata },
        })),
        txLayer: layout.txLayer,
        presentTxIds: present,
        dividers: layout.dividers,
        bounds: layout.bounds,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newestFirst, ordered, dataStamp, labelAddress, walletAssetMetadata, testIdSuffix, govBadgesByTx]);

  // Node positions are stateful so users can drag cards around; new data
  // resets to the computed layout (the viewport is left untouched).
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  useEffect(() => {
    setNodes(layoutNodes);
  }, [layoutNodes, setNodes]);

  const failedQueries = queries.filter((query) => query.isError);
  const anyLoading = queries.some((query) => query.isFetching);
  // Progress over the in-view demand, not the whole history: settled means
  // fetched or errored (errors surface via the failed/Retry affordance).
  const settledHashes = new Set(
    newestFirst.filter((_, index) => queries[index]?.isFetched).map((ref) => ref.txHash),
  );
  const wantedSettled = wanted.filter((hash) => settledHashes.has(hash)).length;
  const detailPending = anyLoading || wantedSettled < wanted.length;

  if (ordered.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
        No on-chain transactions to visualize.
      </div>
    );
  }
  // Nothing renderable yet — only possible when refs carry no store utxos
  // (e.g. a future hash-only caller) and no detail has landed.
  if (presentTxIds.length === 0) {
    if (failedQueries.length > 0 && !anyLoading) {
      return (
        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
          <span>Could not load transaction flows.</span>
          <button
            type="button"
            onClick={() => failedQueries.forEach((query) => void query.refetch())}
            className="flex items-center gap-1 font-medium text-foreground hover:underline"
          >
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        </div>
      );
    }
    return (
      <div className="h-72 w-full animate-pulse rounded-lg border border-border/50 bg-muted/30 sm:h-80" />
    );
  }

  return (
    <div
      data-testid={dataTestId ?? `tx-flow-timeline${testIdSuffix}`}
      className={cn(
        "w-full",
        expanded ? "h-[36rem]" : "h-72 sm:h-80",
        className,
      )}
    >
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        colorMode="system"
        minZoom={0.15}
        maxZoom={1.5}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        zoomOnPinch
        panOnDrag
        proOptions={{ hideAttribution: false }}
        className="!bg-muted/20 rounded-lg border border-border/50"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        {/* Event boundary lines, one between each pair of loaded adjacent
            txs. ViewportPortal pans/zooms with the graph but stays out of
            getNodes(), so fitBounds and drag state never see them; zIndex -1
            paints them behind cards, edges, and chips (nodes carry inline
            z-index 0) while staying above the dot background. */}
        {dividers.length > 0 && (
          <ViewportPortal>
            {dividers.map((divider) => (
              <div
                key={divider.index}
                data-testid={`tx-flow-divider-${divider.index}${testIdSuffix}`}
                className="pointer-events-none absolute w-0.5 rounded-full bg-border dark:bg-foreground/25"
                style={{
                  left: divider.x - 1,
                  top: bounds.minY - DIVIDER_MARGIN,
                  height: bounds.maxY - bounds.minY + 2 * DIVIDER_MARGIN,
                  zIndex: -1,
                }}
              />
            ))}
          </ViewportPortal>
        )}
        {(detailPending || failedQueries.length > 0) && (
          <Panel position="top-left" className="max-w-[calc(100%-10rem)]">
            <div
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground",
                GLASS_PANEL_CLASS,
              )}
            >
              {detailPending && (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading details {wantedSettled} of {wanted.length} in view…
                </span>
              )}
              {failedQueries.length > 0 && !detailPending && (
                <button
                  type="button"
                  onClick={() =>
                    failedQueries.forEach((query) => void query.refetch())
                  }
                  className="flex items-center gap-1 text-foreground hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  {failedQueries.length} failed · Retry
                </button>
              )}
            </div>
          </Panel>
        )}
        <Panel position="top-right">
          <div className="flex items-center gap-1">
            <ResetLayoutButton
              onReset={() => setNodes(layoutNodes)}
              data-testid={`tx-flow-reset${testIdSuffix}`}
            />
            <button
              type="button"
              data-testid={`tx-flow-timeline-expand${testIdSuffix}`}
              title={expanded ? "Collapse view" : "Expand view"}
              onClick={() => setExpanded((current) => !current)}
              className={CANVAS_BUTTON_CLASS}
            >
              {expanded ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </button>
          </div>
        </Panel>
        <TimelineViewportController
          orderedLoadedTxIds={presentTxIds}
          txLayer={txLayer}
          testIdSuffix={testIdSuffix}
          onVisibleTxs={handleVisibleTxs}
        />
      </ReactFlow>
    </div>
  );
}
