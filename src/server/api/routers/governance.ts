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

// Both procedures are public, and refreshProposalTally interpolates the id
// into a Blockfrost path called with the server key, then upserts a row keyed
// by it. A free-form string let an anonymous caller steer that request to any
// Blockfrost GET (`x/../../../health?#0`), and every distinct string that came
// back 200 left a permanent ProposalTally row behind. Only the shape a real
// governance action id has — a 64-hex tx hash and a small cert index — gets
// through now, and only in its one canonical spelling (lowercase hex, no
// leading zeros): Blockfrost resolves `ABC…#00` to the same proposal as
// `abc…#0`, so each alias would otherwise be another row for the same tally.
// The proposals list builds ids from Blockfrost's own lowercase tx_hash and a
// numeric cert_index, so it always sends the canonical form.
const proposalIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}#(0|[1-9]\d{0,3})$/, "Expected <txHash>#<certIndex>");
// 0 = preprod, 1 = mainnet; getProvider() reads anything else as mainnet.
const networkSchema = z.number().int().min(0).max(1);
// The proposals list sends every id it has loaded, and "load more" only ever
// grows that list. This is far above the number of governance actions either
// network has, so it bounds the read without cutting off a real client.
const MAX_TALLY_IDS = 1000;

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
        network: networkSchema,
        proposalIds: z.array(proposalIdSchema).max(MAX_TALLY_IDS),
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
        network: networkSchema,
        proposalId: proposalIdSchema,
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
