import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { getProvider } from "@/utils/get-provider";
import { parseProposalId } from "@/lib/governance";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
// Recompute from Blockfrost at most this often per proposal. The client triggers
// a refresh on load and on every expand, so this guard keeps redundant activity
// cheap and protects the upstream provider.
const REFRESH_TTL_MS = 10 * 60 * 1000;

type TallyChoice = "yes" | "no" | "abstain";

interface VoteItem {
  voter_hot_id?: string | null;
  voter?: string | null;
  tx_hash?: string | null;
  vote?: string | null;
}

interface TallyResult {
  proposalId: string;
  yes: number;
  no: number;
  abstain: number;
  total: number;
  capped: boolean;
  updatedAt?: Date;
}

type TallyRow = {
  proposalId: string;
  yes: number;
  no: number;
  abstain: number;
  total: number;
  capped: boolean;
  updatedAt: Date;
};

const toResult = (row: TallyRow): TallyResult => ({
  proposalId: row.proposalId,
  yes: row.yes,
  no: row.no,
  abstain: row.abstain,
  total: row.total,
  capped: row.capped,
  updatedAt: row.updatedAt,
});

export const governanceRouter = createTRPCRouter({
  getProposalTallies: publicProcedure
    .input(
      z.object({
        network: z.number(),
        proposalIds: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.proposalIds.length === 0) {
        return [] as TallyResult[];
      }

      const rows = await ctx.db.proposalTally.findMany({
        where: {
          network: input.network,
          proposalId: { in: input.proposalIds },
        },
      });

      return rows.map((row) => ({
        proposalId: row.proposalId,
        yes: row.yes,
        no: row.no,
        abstain: row.abstain,
        total: row.total,
        capped: row.capped,
        updatedAt: row.updatedAt,
      }));
    }),

  refreshProposalTally: publicProcedure
    .input(
      z.object({
        network: z.number(),
        proposalId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<TallyResult> => {
      const { network, proposalId } = input;

      // Serve a recently-refreshed row without re-hitting Blockfrost.
      const cached = await ctx.db.proposalTally.findUnique({
        where: { network_proposalId: { network, proposalId } },
      });
      if (cached && Date.now() - cached.updatedAt.getTime() < REFRESH_TTL_MS) {
        return toResult(cached);
      }

      try {
        const { txHash, certIndex } = parseProposalId(proposalId);
        const provider = getProvider(network);

        const latestVotes = new Map<string, TallyChoice>();
        let capped = false;

        for (let page = 1; page <= MAX_PAGES; page++) {
          const items = (await provider.get(
            `/governance/proposals/${txHash}/${certIndex}/votes?count=${PAGE_SIZE}&page=${page}&order=asc`,
          )) as VoteItem[];

          const list = Array.isArray(items) ? items : [];

          for (const item of list) {
            const key = item.voter_hot_id ?? item.voter ?? item.tx_hash;
            if (!key) continue;
            const vote = (item.vote ?? "").toLowerCase();
            if (vote === "yes" || vote === "no" || vote === "abstain") {
              latestVotes.set(key, vote);
            }
          }

          if (list.length < PAGE_SIZE) {
            break;
          }

          if (page === MAX_PAGES) {
            capped = true;
          }
        }

        let yes = 0;
        let no = 0;
        let abstain = 0;
        for (const choice of latestVotes.values()) {
          if (choice === "yes") yes++;
          else if (choice === "no") no++;
          else abstain++;
        }
        const total = yes + no + abstain;

        const row = await ctx.db.proposalTally.upsert({
          where: { network_proposalId: { network, proposalId } },
          create: { network, proposalId, yes, no, abstain, total, capped },
          update: { yes, no, abstain, total, capped },
        });

        return toResult(row);
      } catch {
        // Blockfrost failed — fall back to the (stale) cached row if we have one,
        // otherwise a zeroed tally so the card just renders "no votes".
        if (cached) return toResult(cached);
        return {
          proposalId,
          yes: 0,
          no: 0,
          abstain: 0,
          total: 0,
          capped: false,
        };
      }
    }),
});
