import React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Clock, Network } from "lucide-react";

import { Reveal } from "@/components/ui/reveal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  AHEAD_OF_SCHEDULE,
  CURRENT_MONTH,
  DELIVERED,
  MONTHS,
  STATS,
  TRACKS,
  type RoadmapItem,
  type Status,
} from "./data";

/**
 * Status is encoded by fill *and* by icon and label, never by colour alone —
 * emerald/amber separate under the common forms of colour blindness in a way
 * emerald/red does not, so red stays reserved for the single critical callout
 * rather than being reused as a chart colour. "Planned" is deliberately not a
 * fourth hue: absence of status reads better as an outline than as grey fill.
 */
const STATUS_BAR: Record<Status, string> = {
  done: "border-emerald-600/50 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-300",
  risk: "border-amber-600/50 bg-amber-500/10 text-amber-700 dark:border-amber-500/50 dark:text-amber-300",
  planned:
    "border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground hover:border-foreground/40",
};

const STATUS_LABEL: Record<Status, string> = {
  done: "Delivered",
  risk: "Blocked / at risk",
  planned: "Planned",
};

function StatusIcon({ status }: { status: Status }) {
  if (status === "done") return <Check className="h-3 w-3 shrink-0" />;
  if (status === "risk")
    return <AlertTriangle className="h-3 w-3 shrink-0" />;
  return null;
}

/** One bar in the timeline: a month range on a track, with its detail on hover. */
function Bar({ item, row }: { item: RoadmapItem; row: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          style={{
            gridColumn: `${item.start + 1} / span ${item.span}`,
            gridRow: row,
          }}
          className={`relative z-10 mx-[3px] my-1.5 flex min-h-[34px] items-center gap-1.5 self-center rounded-md border px-2 pb-3 pt-1.5 text-[11px] font-medium leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${STATUS_BAR[item.status]}`}
        >
          <StatusIcon status={item.status} />
          {/* min-w-0 lets the flex child shrink so a long single word wraps
              instead of spilling past the bar into the next month. */}
          <span className="min-w-0 break-words">{item.label}</span>
          {item.owner && (
            <span className="absolute bottom-0.5 right-1.5 font-mono text-[9px] font-bold uppercase tracking-wider opacity-70">
              {item.owner}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[280px]">
        <p className="text-xs font-semibold">{item.label}</p>
        <p className="mt-1 text-xs font-normal text-muted-foreground">
          {item.detail}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {(["done", "risk", "planned"] as Status[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-2">
          <span
            className={`inline-block h-3 w-6 shrink-0 rounded-sm border ${STATUS_BAR[s]}`}
          />
          {STATUS_LABEL[s]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[10px] font-bold">Q</span> Quirin
        <span className="ml-2 font-mono text-[10px] font-bold">A</span> Andre
      </span>
    </div>
  );
}

/**
 * The month grid. Every cell is placed explicitly — the "today" rule spans all
 * rows, and a grid item with a definite position is packed before auto-placed
 * siblings, which would otherwise shove the month headers a column to the right.
 *
 * Stacking order matters because the first column is sticky: cells (auto) sit
 * under bars and the today rule (z-10), which slide under the frozen workstream
 * column (z-20) as the grid scrolls, which in turn sits under the frozen corner
 * (z-30). Every sticky cell needs an opaque background, or scrolled bars show
 * through it.
 */
function Timeline() {
  const columns = `minmax(168px, 184px) repeat(${MONTHS.length}, minmax(84px, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card/40">
      <div
        className="relative grid min-w-[1340px]"
        style={{ gridTemplateColumns: columns }}
      >
        {/* header row */}
        <div
          style={{ gridColumn: 1, gridRow: 1 }}
          className="sticky left-0 z-30 flex flex-col justify-center border-b border-r border-border bg-muted px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          Workstream
        </div>
        {MONTHS.map((m, i) => {
          const n = i + 1;
          const isNow = n === CURRENT_MONTH;
          const isPast = n < CURRENT_MONTH;
          return (
            <div
              key={`${m.short}-${m.year}`}
              style={{ gridColumn: n + 1, gridRow: 1 }}
              className={`flex flex-col items-center border-b border-border py-2 font-mono text-[10px] uppercase tracking-wider ${
                isNow
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : isPast
                    ? "bg-muted/50 text-muted-foreground/70"
                    : "bg-muted/50 text-muted-foreground"
              }`}
            >
              <span>{m.short}</span>
              <span className="text-[9px] opacity-60">{m.year}</span>
              {/* the marker lives inside the cell, so it cannot collide with a neighbouring header */}
              {isNow && (
                <span className="mt-0.5 rounded bg-amber-500/15 px-1 text-[8px] tracking-[0.14em]">
                  today
                </span>
              )}
            </div>
          );
        })}

        {/* today rule, on the right edge of the current month. Kept at the bar
            layer (z-10) so the frozen first column covers it once the grid is
            scrolled horizontally, same as the bars. */}
        <div
          style={{ gridColumn: CURRENT_MONTH + 2, gridRow: "1 / -1" }}
          className="pointer-events-none z-10 w-0 justify-self-start border-l-2 border-amber-500"
        />

        {TRACKS.map((track, t) => {
          const row = t + 2;
          return (
            <React.Fragment key={track.name}>
              <div
                style={{ gridColumn: 1, gridRow: row }}
                className="sticky left-0 z-20 flex flex-col justify-center border-b border-r border-border bg-card px-4 py-3"
              >
                <span className="text-[13px] font-semibold leading-tight">
                  {track.name}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {track.sub}
                </span>
              </div>

              {MONTHS.map((m, i) => (
                <div
                  key={`${track.name}-${m.short}-${i}`}
                  style={{ gridColumn: i + 2, gridRow: row }}
                  className={`min-h-[56px] border-b border-r border-border ${
                    i + 1 === CURRENT_MONTH ? "bg-amber-500/[0.04]" : ""
                  }`}
                />
              ))}

              {track.items.map((item) => (
                <Bar key={`${track.name}-${item.label}`} item={item} row={row} />
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function PageRoadmap() {
  return (
    <TooltipProvider delayDuration={120}>
      {/* w-full + min-w-0 keep this flex item at the width of its container:
          `mx-auto` suppresses flex stretch, which would otherwise leave the box
          sized to the timeline grid's 1180px min-content and push the whole page
          wider than the viewport instead of letting the grid scroll on its own. */}
      <div className="relative z-20 mx-auto w-full min-w-0 max-w-7xl py-10 lg:py-8">
        <div className="px-8">
          <h1 className="mx-auto max-w-5xl text-center text-3xl font-medium tracking-tight text-black dark:text-white lg:text-5xl lg:leading-tight">
            Roadmap
          </h1>
          <p className="mx-auto my-4 max-w-2xl text-center text-sm font-normal text-neutral-500 dark:text-neutral-300 lg:text-base">
            Twelve months of Mesh Multisig, April 2026 to March 2027 — what has
            shipped, what is blocked, and what comes next.
          </p>
          <p className="mx-auto max-w-2xl text-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            revised 2026-07-26
          </p>
        </div>

        <div className="mt-10 flex min-w-0 flex-col gap-12 px-4 sm:px-8">
          {/* release gap — the one genuinely critical item, so red is reserved for it */}
          <Reveal>
            <section className="flex items-start gap-3 rounded-xl border border-red-600/40 bg-red-500/[0.07] p-5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">
                  Production is three months behind the work
                </h2>
                <p className="max-w-[78ch] text-sm text-muted-foreground">
                  The production database has applied no migration since{" "}
                  <span className="font-medium text-foreground">2026-05-10</span>
                  . Four are outstanding, and{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    preprod
                  </code>{" "}
                  is{" "}
                  <span className="font-medium text-foreground">
                    75 commits ahead of{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                      main
                    </code>
                  </span>{" "}
                  — so June and July are built but unreleased.{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    deploy-migrations.yml
                  </code>{" "}
                  only fires on pushes to{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    main
                  </code>{" "}
                  touching{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    prisma/migrations/**
                  </code>
                  , so repairing the workflow never re-triggered the run that
                  failed on 17 June.
                </p>
                <p className="max-w-[78ch] text-sm text-muted-foreground">
                  Live consequences: governance tallies error, the notification
                  center has no tables, address-less bot registration cannot
                  work — and seven tables still have row-level security
                  disabled, reachable by the anon PostgREST role. The fix is
                  written and merged; it is only undeployed.
                </p>
              </div>
            </section>
          </Reveal>

          {/* summary strip */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {STATS.map((s, i) => (
              <Reveal key={s.k} delayMs={(i % 5) * 60}>
                <div className="flex h-full flex-col gap-1 rounded-xl border border-border bg-card/40 p-4">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.k}
                  </span>
                  <span
                    className={`text-3xl font-semibold tabular-nums leading-none tracking-tight ${
                      s.tone === "good"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : s.tone === "bad"
                          ? "text-red-600 dark:text-red-400"
                          : ""
                    }`}
                  >
                    {s.v}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {s.n}
                  </span>
                </div>
              </Reveal>
            ))}
          </section>

          {/* timeline */}
          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1 border-b border-border pb-3">
              <h2 className="text-xl font-semibold tracking-tight">
                Workstream timeline
              </h2>
              <p className="max-w-[72ch] text-sm text-muted-foreground">
                Grouped by workstream rather than by owner, so continuity from
                delivered to planned stays visible. Hover or focus any bar for
                the detail behind it.
              </p>
            </div>
            <Legend />
            <Timeline />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                Status reflects the <code className="font-mono">preprod</code>{" "}
                branch. Delivered does not mean live.
              </p>
              <Link
                href="/roadmap/graph"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                <Network className="h-3.5 w-3.5 shrink-0" />
                Explore the same work as a feature graph
              </Link>
            </div>
          </section>

          {/* ahead of schedule */}
          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1 border-b border-border pb-3">
              <h2 className="text-xl font-semibold tracking-tight">
                Landed ahead of schedule
              </h2>
              <p className="max-w-[72ch] text-sm text-muted-foreground">
                July over-delivered against the plan. Four capabilities arrived
                before their slot, which is what freed November and December to
                absorb new work.
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border bg-card/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Capability</TableHead>
                    <TableHead>Planned</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>Effect on the plan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AHEAD_OF_SCHEDULE.map((r) => (
                    <TableRow key={r.capability}>
                      <TableCell className="font-medium">
                        {r.capability}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {r.planned}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {r.delivered}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.effect}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* delivered inventory */}
          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1 border-b border-border pb-3">
              <h2 className="text-xl font-semibold tracking-tight">
                Delivered to date
              </h2>
              <p className="max-w-[72ch] text-sm text-muted-foreground">
                What the product can do today, verified against the codebase on
                2026-07-26 rather than inferred from pull-request titles.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {DELIVERED.map((group, i) => (
                <Reveal key={group.title} delayMs={(i % 3) * 80}>
                  <div className="flex h-full flex-col rounded-xl border border-border bg-card/40 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700">
                    <h3 className="text-lg font-semibold tracking-tight">
                      {group.title}
                    </h3>
                    <ul className="mt-3 flex flex-col gap-2">
                      {group.points.map((p) => (
                        <li
                          key={p}
                          className="flex gap-2 text-sm text-muted-foreground"
                        >
                          <Check className="mt-1 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          <p className="text-center text-xs text-muted-foreground">
            Source of record:{" "}
            <a
              className="underline underline-offset-4 hover:text-foreground"
              href="https://github.com/MeshJS/multisig/blob/preprod/ROADMAP.md"
              target="_blank"
              rel="noreferrer"
            >
              ROADMAP.md
            </a>
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default PageRoadmap;
