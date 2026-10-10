import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";

import type { BlockfrostDrepUpdate, BlockfrostTxInfo } from "@/types/blockfrost";
import type { DrepVoteHistoryResponse } from "@/types/governance";
import type { AddressLabeler, AddressPartyType } from "@/types/token-flow";
import type { TxInfo } from "@/types/transaction";
import TokenFlowTimeline from "@/components/common/token-flow/timeline";
import { Reveal } from "@/components/ui/reveal";
import { getProvider } from "@/utils/get-provider";
import type { TimelineTxRef } from "@/utils/token-flow";

/**
 * Live token-flow timeline demo for the public /features page: the last 20
 * transactions of the team's preprod test multisig, fetched client-direct
 * from Blockfrost, plus its most recent governance activity (votes, DRep
 * registration) merged in explicitly — the wallet has 1000+ txs, so
 * governance events never survive a newest-N window on their own. The tx
 * list refreshes at most once a day (localStorage TTL); per-tx detail is
 * fetched on demand by the timeline itself.
 */

const DEMO_WALLET_ADDRESS =
  "addr_test1xrlpypv3vgrg6scz4emwl5u9z5aq3m5z4m2x5zn0gguvu6hgvlu8ex7a4h9wf88xp4ps6hm9sak89g9td04t9kzrfs9s4grkd5";
/** The demo multisig votes under its payment script, so this is that
 *  script hash as a CIP-129 DRep id — lets the timeline badge its votes. */
const DEMO_WALLET_DREP_ID =
  "drep1y0lpypv3vgrg6scz4emwl5u9z5aq3m5z4m2x5zn0gguvu6sv8yks9";
/** Same script hash in the CIP-105 form Blockfrost's drep endpoints use. */
const DEMO_WALLET_DREP_ID_CIP105 =
  "drep_script1lcfqtytzq6x5xq4wwmha8pg48gywaq4w634q5m6z8r8x57xqszj";
const PREPROD = 0;
const DEMO_TX_COUNT = 20;
/** Most recent DRep votes to splice into the timeline. */
const DEMO_VOTE_TX_COUNT = 4;

// v2: governance txs joined into the cached ref list.
const REFS_CACHE_KEY = "features-demo-txs-v2";
const REFS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The demo DRep's recent governance txs as timeline refs: latest votes plus
 * the latest registration. Best-effort — the demo works without them.
 */
async function fetchDemoGovernanceRefs(): Promise<TimelineTxRef[]> {
  const provider = getProvider(PREPROD);
  const refs: TimelineTxRef[] = [];
  try {
    const res = await fetch(
      `/api/governance/drepVotes?drepId=${DEMO_WALLET_DREP_ID}&network=${PREPROD}`,
    );
    if (res.ok) {
      const body = (await res.json()) as DrepVoteHistoryResponse;
      for (const vote of body.votes.slice(0, DEMO_VOTE_TX_COUNT)) {
        refs.push({
          txHash: vote.voteTxHash,
          blockTime: vote.blockTime,
          // Ordering only needs blockTime here (height/index are same-block
          // tie-breakers); the real height shows once tx detail loads.
          blockHeight: 0,
          txIndex: 0,
        });
      }
    }
  } catch {
    // Vote list is a bonus for the demo — skip on failure.
  }
  try {
    // order=desc: Blockfrost defaults to ascending, which for the CI DRep's
    // churn (register + retire every run) would return only ancient updates.
    const updates: BlockfrostDrepUpdate[] = await provider.get(
      `/governance/dreps/${DEMO_WALLET_DREP_ID_CIP105}/updates?order=desc&count=100`,
    );
    const registration = updates.find(
      (update) => update.action === "registered",
    );
    if (registration) {
      // /updates carries no timestamp; one tx-info call fills it in (the
      // result is inside the day-cached ref list, so this stays rare).
      const info: BlockfrostTxInfo = await provider.get(
        `/txs/${registration.tx_hash}`,
      );
      refs.push({
        txHash: registration.tx_hash,
        blockTime: info.block_time,
        blockHeight: info.block_height,
        txIndex: 0,
      });
    }
  } catch {
    // Unregistered DRep (404) or endpoint hiccup — skip.
  }
  return refs;
}

async function fetchDemoTxRefs(): Promise<TimelineTxRef[]> {
  try {
    const raw = localStorage.getItem(REFS_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as { ts: number; txs: TimelineTxRef[] };
      if (Date.now() - cached.ts < REFS_TTL_MS && cached.txs.length > 0) {
        return cached.txs;
      }
    }
  } catch {
    // Corrupt or blocked storage — fall through to the network.
  }
  const provider = getProvider(PREPROD);
  const txInfos: TxInfo[] = await provider.get(
    `/addresses/${DEMO_WALLET_ADDRESS}/transactions?order=desc&count=${DEMO_TX_COUNT}`,
  );
  const txs: TimelineTxRef[] = txInfos.map((tx) => ({
    txHash: tx.tx_hash,
    blockTime: tx.block_time,
    blockHeight: tx.block_height,
    txIndex: tx.tx_index,
  }));
  const seen = new Set(txs.map((tx) => tx.txHash));
  for (const ref of await fetchDemoGovernanceRefs()) {
    if (!seen.has(ref.txHash)) {
      seen.add(ref.txHash);
      txs.push(ref);
    }
  }
  try {
    localStorage.setItem(
      REFS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), txs }),
    );
  } catch {
    // Storage full/blocked — caching is best-effort.
  }
  return txs;
}

const DEMO_ADDRESS_LABELS: Record<
  string,
  { label: string; type: AddressPartyType }
> = {
  [DEMO_WALLET_ADDRESS]: { label: "Team Multisig", type: "self" },
  // Recurring counterparties from the test runs; strangers stay unlabeled.
  addr_test1wr3q6ty3h6hkd8jt2aq5h3veypf4tneyuq8qrts5g9426gcy28f65: {
    label: "Funding Wallet",
    type: "contact",
  },
  addr_test1wqgc0wpucdrrxynfsv40nxeu68lrumzuj2079uchsscs7jgl5t6n5: {
    label: "Recipient",
    type: "contact",
  },
};

const demoLabelAddress: AddressLabeler = (address) =>
  DEMO_ADDRESS_LABELS[address] ?? { label: "", type: "unknown" };

export function TokenFlowDemo() {
  const demoTxsQuery = useQuery({
    queryKey: ["demo-addr-txs", PREPROD, DEMO_WALLET_ADDRESS],
    queryFn: fetchDemoTxRefs,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
  });

  return (
    <section className="mt-16 px-4 sm:px-8">
      <Reveal>
        <h2 className="mx-auto max-w-5xl text-center text-2xl font-medium tracking-tight text-black dark:text-white lg:text-3xl">
          Follow every token, live
        </h2>
        <p className="mx-auto my-3 max-w-2xl text-center text-sm font-normal text-neutral-500 dark:text-neutral-300 lg:text-base">
          The latest transactions of a real multisig on Cardano&apos;s preprod
          network, fetched live and drawn as a token-flow timeline. Drag to
          pan, step between transactions, and trace where every asset went.
        </p>
        {demoTxsQuery.data?.length ? (
          <TokenFlowTimeline
            txs={demoTxsQuery.data}
            network={PREPROD}
            labelAddress={demoLabelAddress}
            testIdSuffix="-features-demo"
            className="mt-6"
          />
        ) : demoTxsQuery.isError ? (
          <div className="mt-6 flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
            <span>Could not load demo transactions.</span>
            <button
              type="button"
              onClick={() => void demoTxsQuery.refetch()}
              className="flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
          </div>
        ) : (
          <div className="mt-6 h-72 w-full animate-pulse rounded-lg border border-border/50 bg-muted/30 sm:h-80" />
        )}
      </Reveal>
    </section>
  );
}
