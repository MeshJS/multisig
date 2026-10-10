import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { ShieldCheck, Clock, Check } from "lucide-react";

const SIGNERS = [
  { initials: "AB", name: "alice.ada" },
  { initials: "CD", name: "bob.cardano" },
  { initials: "EF", name: "carol.io" },
  { initials: "GH", name: "dave" },
  { initials: "IJ", name: "erin" },
];
const THRESHOLD = 3;

/** A checkmark in a seal that "draws" itself when the signer signs. */
function CheckSeal({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
        active
          ? "border-emerald-400 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          : "border-border bg-muted/40 text-muted-foreground/40",
      )}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          d="M5 12l4.5 4.5L19 7"
          strokeDasharray="26"
          style={{
            strokeDashoffset: active ? 0 : 26,
            transition: "stroke-dashoffset 0.45s ease 0.08s",
          }}
        />
      </svg>
    </span>
  );
}

/**
 * Animated explainer of M-of-N signing: a 3-of-5 transaction collects
 * signatures one by one; the moment the third lands, the transaction executes.
 * Loops on a timer (steady still-state under reduced-motion).
 */
export function MultisigSigningExplainer() {
  const reduced = useReducedMotion();
  const [signed, setSigned] = useState(reduced ? THRESHOLD : 0);

  useEffect(() => {
    if (reduced) {
      setSigned(THRESHOLD);
      return;
    }
    // 0 → 1 → 2 → 3 (executes), hold, then reset and repeat.
    const seq = [0, 1, 2, 3, 3, 3, 0];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % seq.length;
      setSigned(seq[i]!);
    }, 850);
    return () => clearInterval(id);
  }, [reduced]);

  const approved = signed >= THRESHOLD;
  const remaining = Math.max(0, THRESHOLD - signed);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm">
      {/* Transaction header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">Send ₳ 5,000</p>
            <p className="truncate text-xs text-muted-foreground">
              Core Team Treasury · 3-of-5
            </p>
          </div>
        </div>
        {approved ? (
          <Badge
            variant="outline"
            className="gap-1 whitespace-nowrap border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <Check className="h-3 w-3" />
            Executed
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 whitespace-nowrap">
            <Clock className="h-3 w-3" />
            {remaining} more
          </Badge>
        )}
      </div>

      {/* Threshold progress */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Required signatures</span>
          <span className="tabular-nums">
            {Math.min(signed, THRESHOLD)} / {THRESHOLD}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out",
              approved ? "bg-emerald-500" : "bg-foreground/70",
            )}
            style={{
              width: `${(Math.min(signed, THRESHOLD) / THRESHOLD) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Signers */}
      <div className="mt-4 space-y-2">
        {SIGNERS.map((s, idx) => {
          const isSigned = idx < signed;
          const status = isSigned
            ? "Signed"
            : approved
              ? "Not needed"
              : "Awaiting signature";
          return (
            <div
              key={s.name}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-2.5 py-2 transition-colors duration-300",
                isSigned
                  ? "border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                  : "border-border/60 bg-background/40",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-all duration-300",
                  isSigned
                    ? "bg-emerald-400/20 text-emerald-700 ring-2 ring-emerald-400 dark:text-emerald-300"
                    : "bg-gradient-to-br from-zinc-200 to-zinc-300 text-zinc-700 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-200",
                )}
              >
                {s.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{s.name}</p>
                <p className="text-[10px] text-muted-foreground">{status}</p>
              </div>
              <CheckSeal active={isSigned} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MultisigSigningExplainer;
