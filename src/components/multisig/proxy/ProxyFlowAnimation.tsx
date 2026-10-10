import React, { useId } from "react";

/**
 * Animated UTxO flow for the three proxy transaction shapes.
 *
 * Motion is CSS-only: each travelling dot translates by a per-dot `--dx`/`--dy`
 * delta, and the two keyframe sets stagger inputs (first 40% of the cycle) from
 * outputs (40–80%), so one shared duration keeps every dot in step. Honours
 * prefers-reduced-motion by freezing the diagram.
 */

export type ProxyFlowVariant = "setup" | "action" | "cleanup";

type Tone = "wallet" | "proxy" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  wallet: "fill-primary/10 stroke-primary/40",
  proxy: "fill-emerald-500/10 stroke-emerald-500/40",
  neutral: "fill-muted/70 stroke-border",
};

const DOT_CLASS: Record<Tone, string> = {
  wallet: "fill-primary",
  proxy: "fill-emerald-500",
  neutral: "fill-muted-foreground",
};

function Node({
  x,
  y,
  w,
  h,
  title,
  sub,
  tone,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  tone: Tone;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        className={TONE_CLASS[tone]}
        strokeWidth={1}
      />
      <text
        x={x + 12}
        y={sub ? y + 20 : y + h / 2 + 4}
        className="fill-foreground text-[11px] font-medium"
      >
        {title}
      </text>
      {sub && (
        <text x={x + 12} y={y + 36} className="fill-muted-foreground text-[10px]">
          {sub}
        </text>
      )}
    </g>
  );
}

function Dot({
  x,
  y,
  dx,
  dy,
  tone,
  stage,
}: {
  x: number;
  y: number;
  dx: number;
  dy: number;
  tone: Tone;
  stage: 1 | 2;
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r={4}
      className={`pxflow-dot pxflow-dot-${stage} ${DOT_CLASS[tone]}`}
      style={
        {
          "--dx": `${dx}px`,
          "--dy": `${dy}px`,
        } as React.CSSProperties
      }
    />
  );
}

const STYLES = `
.pxflow-dot { opacity: 0; }
.pxflow-animate .pxflow-dot-1 { animation: pxflow-in 3s ease-in-out infinite; }
.pxflow-animate .pxflow-dot-2 { animation: pxflow-out 3s ease-in-out infinite; }
@keyframes pxflow-in {
  0% { opacity: 0; transform: translate(0, 0); }
  6% { opacity: 1; }
  38% { opacity: 1; transform: translate(var(--dx), var(--dy)); }
  44%, 100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
}
@keyframes pxflow-out {
  0%, 40% { opacity: 0; transform: translate(0, 0); }
  46% { opacity: 1; transform: translate(0, 0); }
  78% { opacity: 1; transform: translate(var(--dx), var(--dy)); }
  84%, 100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
}
@media (prefers-reduced-motion: reduce) {
  .pxflow-animate .pxflow-dot-1, .pxflow-animate .pxflow-dot-2 { animation: none; }
}
`;

const CAPTION: Record<ProxyFlowVariant, string> = {
  setup:
    "Setup spends one wallet UTxO, mints ten auth tokens, and funds the proxy address.",
  action:
    "Any proxy action spends proxy UTxOs with one auth token, which returns to the wallet.",
  cleanup:
    "Cleanup burns all ten auth tokens once the proxy address is empty.",
};

export default function ProxyFlowAnimation({
  variant,
  animate = true,
  className = "",
}: {
  variant: ProxyFlowVariant;
  /** Freeze the dots — used for completed steps. */
  animate?: boolean;
  className?: string;
}) {
  const markerId = `pxflow-arrow-${useId().replace(/:/g, "")}`;
  const arrow = `url(#${markerId})`;
  const line = "stroke-border";

  return (
    <div className={`glass-subtle rounded-xl border p-3 ${className}`}>
      <style>{STYLES}</style>
      <svg
        viewBox="0 0 560 132"
        width="100%"
        role="img"
        aria-label={CAPTION[variant]}
        className={animate ? "pxflow-animate" : undefined}
      >
        <title>{CAPTION[variant]}</title>
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path
              d="M2 1L8 5L2 9"
              fill="none"
              className="stroke-border"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>

        {variant === "setup" && (
          <>
            <Node x={8} y={44} w={140} h={44} title="Wallet UTxO" sub="at least 20 ADA" tone="wallet" />
            <Node x={196} y={44} w={118} h={44} title="Mint" sub="10 auth tokens" tone="neutral" />
            <Node x={362} y={6} w={190} h={44} title="Proxy address" sub="1 ADA locked" tone="proxy" />
            <Node x={362} y={82} w={190} h={44} title="Multisig wallet" sub="10 auth tokens" tone="wallet" />
            <line x1={148} y1={66} x2={194} y2={66} className={line} markerEnd={arrow} />
            <line x1={314} y1={62} x2={360} y2={30} className={line} markerEnd={arrow} />
            <line x1={314} y1={70} x2={360} y2={102} className={line} markerEnd={arrow} />
            <Dot x={152} y={66} dx={38} dy={0} tone="wallet" stage={1} />
            <Dot x={318} y={60} dx={38} dy={-32} tone="proxy" stage={2} />
            <Dot x={318} y={72} dx={38} dy={32} tone="wallet" stage={2} />
          </>
        )}

        {variant === "action" && (
          <>
            <Node x={8} y={6} w={150} h={44} title="Proxy UTxOs" sub="funds to spend" tone="proxy" />
            <Node x={8} y={82} w={150} h={44} title="1 auth token" sub="from the wallet" tone="wallet" />
            <Node x={206} y={44} w={110} h={44} title="Script" sub="sees token" tone="neutral" />
            <Node x={364} y={2} w={188} h={36} title="Recipient paid" tone="neutral" />
            <Node x={364} y={48} w={188} h={36} title="Token returns" tone="wallet" />
            <Node x={364} y={94} w={188} h={36} title="Change to proxy" tone="proxy" />
            <line x1={158} y1={30} x2={204} y2={58} className={line} markerEnd={arrow} />
            <line x1={158} y1={102} x2={204} y2={74} className={line} markerEnd={arrow} />
            <line x1={316} y1={58} x2={362} y2={22} className={line} markerEnd={arrow} />
            <line x1={316} y1={66} x2={362} y2={66} className={line} markerEnd={arrow} />
            <line x1={316} y1={74} x2={362} y2={110} className={line} markerEnd={arrow} />
            <Dot x={162} y={32} dx={38} dy={24} tone="proxy" stage={1} />
            <Dot x={162} y={100} dx={38} dy={-24} tone="wallet" stage={1} />
            <Dot x={320} y={58} dx={38} dy={-34} tone="neutral" stage={2} />
            <Dot x={320} y={66} dx={38} dy={0} tone="wallet" stage={2} />
            <Dot x={320} y={74} dx={38} dy={34} tone="proxy" stage={2} />
          </>
        )}

        {variant === "cleanup" && (
          <>
            <Node x={8} y={44} w={160} h={44} title="All 10 tokens" sub="in a single tx" tone="wallet" />
            <Node x={216} y={44} w={118} h={44} title="Burn" sub="policy closed" tone="neutral" />
            <Node x={382} y={44} w={170} h={44} title="Proxy retired" sub="address empty" tone="proxy" />
            <line x1={168} y1={66} x2={214} y2={66} className={line} markerEnd={arrow} />
            <line x1={334} y1={66} x2={380} y2={66} className={line} markerEnd={arrow} />
            <Dot x={172} y={66} dx={38} dy={0} tone="wallet" stage={1} />
            <Dot x={338} y={66} dx={38} dy={0} tone="neutral" stage={2} />
          </>
        )}
      </svg>
    </div>
  );
}
