import CardUI from "@/components/common/card-content";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import RowLabelInfo from "@/components/common/row-label-info";
import SectionTitle from "@/components/common/section-title";
import { useSiteStore } from "@/lib/zustand/site";
import { ProposalMetadata } from "@/types/governance";
import { useEffect, useState } from "react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Label,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
  Pie,
  PieChart,
} from "recharts";

const chartConfig = {
  yes: {
    label: "Yes",
    color: "green",
  },
  abstain: {
    label: "Abstain",
    color: "gray",
  },
  no: {
    label: "No",
    color: "red",
  },
} satisfies ChartConfig;

export default function WalletGovernanceProposal({ id }: { id: string }) {
  const network = useSiteStore((state) => state.network);
  const [proposalMetadata, setProposalMetadata] = useState<
    ProposalMetadata | undefined
  >(undefined);
  const [proposalVotes, setProposalVotes] = useState<any>(
    undefined,
  );

  useEffect(() => {
    const blockchainProvider = getProvider(network);
    async function get() {
      const [txHash, certIndex] = id.split(":");
      const proposalData = await blockchainProvider.get(
        `/governance/proposals/${txHash}/${certIndex}/metadata`,
      );

      if (proposalData) {
        setProposalMetadata(proposalData);

        const _proposalVotes = await getVote([], 1);

        const _proposalVotes2 = _proposalVotes.reduce(
          (acc, vote) => {
            if (vote.vote == "yes") {
              acc.yes += 1;
            } else if (vote.vote == "abstain") {
              acc.abstain += 1;
            } else if (vote.vote == "no") {
              acc.no += 1;
            }
            return acc;
          },
          { yes: 0, abstain: 0, no: 0 },
        );

        const proposalVotes = [];
        for (const options of ["yes", "abstain", "no"] as const) {
          proposalVotes.push({
            option: options,
            votes: _proposalVotes2[options] ? _proposalVotes2[options] : 0,
            fill: chartConfig[options].color,
          });
        }

        setProposalVotes(proposalVotes);
      }
    }
    get();
  }, []);

  async function getVote(
    results: any[],
    page: number,
  ): Promise<{ vote: string }[]> {
    const [txHash, certIndex] = id.split(":");
    const blockchainProvider = getProvider(network);
    const proposalVotes = await blockchainProvider.get(
      `/governance/proposals/${txHash}/${certIndex}/votes?page=${page}`,
    );

    if (proposalVotes.length == 100) {
      return results.concat(
        await getVote(results.concat(proposalVotes), page + 1),
      );
    }

    return results.concat(proposalVotes);
  }

  if (!proposalMetadata) return <></>;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <CardUI
        title={proposalMetadata.json_metadata.body.title}
        cardClassName="w-full"
      >
        <RowLabelInfo
          label="Authors"
          value={proposalMetadata.json_metadata.authors
            .map((author: any) => author.name)
            .join(", ")}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Abstract"
          value={proposalMetadata.json_metadata.body.abstract}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Motivation"
          value={proposalMetadata.json_metadata.body.motivation}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Rationale"
          value={proposalMetadata.json_metadata.body.rationale}
          allowOverflow={true}
        />
      </CardUI>

      {proposalVotes && (
        <CardUI title="Votes" cardClassName="w-96">
          <ChartContainer
            config={chartConfig}
            className="mx-auto aspect-square w-full max-w-[250px]"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <Pie
                data={proposalVotes}
                dataKey="votes"
                nameKey="option"
                innerRadius={60}
                strokeWidth={5}
              >
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground text-3xl font-bold"
                          >
                            {proposalVotes.reduce(
                              (acc: any, vote: { votes: any }) =>
                                acc + vote.votes,
                              0,
                            ) || 0}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 24}
                            className="fill-muted-foreground"
                          >
                            Votes
                          </tspan>
                        </text>
                      );
                    }
                  }}
                />
              </Pie>
            </PieChart>
            {/* <RadialBarChart
              data={[proposalVotes]}
              endAngle={180}
              innerRadius={80}
              outerRadius={130}
            >
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) - 16}
                            className="fill-foreground text-2xl font-bold"
                          >
                            {(
                              proposalVotes.yes +
                              proposalVotes.abstain +
                              proposalVotes.no
                            ).toLocaleString()}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 4}
                            className="fill-muted-foreground"
                          >
                            Total Votes
                          </tspan>
                        </text>
                      );
                    }
                  }}
                />
              </PolarRadiusAxis>
              <RadialBar
                dataKey="yes"
                stackId="a"
                cornerRadius={5}
                fill="var(--color-yes)"
                className="stroke-transparent stroke-2"
              />
              <RadialBar
                dataKey="abstain"
                fill="var(--color-abstain)"
                stackId="a"
                cornerRadius={5}
                className="stroke-transparent stroke-2"
              />
              <RadialBar
                dataKey="no"
                fill="var(--color-no)"
                stackId="a"
                cornerRadius={5}
                className="stroke-transparent stroke-2"
              />
            </RadialBarChart> */}
          </ChartContainer>
        </CardUI>
      )}
    </main>
  );
}
