import type { Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";
import {
  buildBallotUpsertPayload,
  getDeterministicActiveProposals,
  type ActiveProposal,
} from "../../framework/governance";
import { getWalletByType } from "./helpers";

export function createScenarioGovernanceRoutes(): Scenario {
  const runtime: {
    activeProposals: ActiveProposal[];
  } = {
    activeProposals: [],
  };
  return {
    id: "scenario.governance-routes",
    description: "Governance route checks for active proposals and ballot upsert",
    steps: [
      {
        id: "v1.governanceActiveProposals.preprod",
        description: "Fetch active governance proposals on preprod",
        severity: "critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const response = await requestJson<{
            proposals?: unknown[];
            activeCount?: number;
            sourceCount?: number;
            error?: string;
          }>({
            url: `${ctx.apiBaseUrl}/api/v1/governanceActiveProposals?network=0&count=20&page=1&order=desc&details=false`,
            method: "GET",
            token,
          });
          if (response.status !== 200) {
            throw new Error(
              `governanceActiveProposals failed (${response.status}): ${stringifyRedacted(response.data)}`,
            );
          }
          runtime.activeProposals = getDeterministicActiveProposals(response.data, 2);
          return {
            message: `governanceActiveProposals returned ${runtime.activeProposals.length} usable active proposal(s)`,
            artifacts: {
              activeCount: response.data?.activeCount,
              sourceCount: response.data?.sourceCount,
              selectedProposalIds: runtime.activeProposals.map((proposal) => proposal.proposalId),
            },
          };
        },
      },
      {
        id: "v1.botBallotsUpsert.legacy",
        description: "Upsert governance ballots from active proposals (with idempotent update)",
        severity: "critical",
        execute: async (ctx) => {
          if (!runtime.activeProposals.length) {
            return {
              message: "No active proposals available on preprod; ballot upsert route skipped",
              artifacts: {
                skipped: true,
              },
            };
          }
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const wallet = getWalletByType(ctx, "legacy") ?? ctx.wallets[0];
          if (!wallet) {
            throw new Error("Missing wallet for governance ballot upsert");
          }
          const ballotName = `CI governance ballot ${ctx.createdAt}`;
          const firstPayload = buildBallotUpsertPayload({
            walletId: wallet.walletId,
            ballotName,
            proposals: runtime.activeProposals,
          });
          const firstResponse = await requestJson<{
            ballot?: { id?: string; items?: string[]; choices?: string[] };
            error?: string;
          }>({
            url: `${ctx.apiBaseUrl}/api/v1/botBallotsUpsert`,
            method: "POST",
            token,
            body: firstPayload as unknown as Record<string, unknown>,
          });
          if (firstResponse.status !== 200 || !firstResponse.data?.ballot?.id) {
            throw new Error(
              `botBallotsUpsert seed failed (${firstResponse.status}): ${stringifyRedacted(firstResponse.data)}`,
            );
          }
          const secondPayload = buildBallotUpsertPayload({
            walletId: wallet.walletId,
            ballotName,
            proposals: runtime.activeProposals,
            secondPass: true,
          });
          const secondResponse = await requestJson<{
            ballot?: { id?: string; items?: string[]; choices?: string[] };
            error?: string;
          }>({
            url: `${ctx.apiBaseUrl}/api/v1/botBallotsUpsert`,
            method: "POST",
            token,
            body: secondPayload as unknown as Record<string, unknown>,
          });
          if (secondResponse.status !== 200 || !secondResponse.data?.ballot?.id) {
            throw new Error(
              `botBallotsUpsert update failed (${secondResponse.status}): ${stringifyRedacted(secondResponse.data)}`,
            );
          }
          if (secondResponse.data.ballot.id !== firstResponse.data.ballot.id) {
            throw new Error("botBallotsUpsert update should target the same ballot");
          }
          return {
            message: `botBallotsUpsert updated ballot ${secondResponse.data.ballot.id}`,
            artifacts: {
              walletId: wallet.walletId,
              ballotId: secondResponse.data.ballot.id,
              proposalCount: runtime.activeProposals.length,
              choices: secondResponse.data.ballot.choices ?? [],
            },
          };
        },
      },
    ],
  };
}
