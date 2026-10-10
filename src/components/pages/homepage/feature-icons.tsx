import { type CSSProperties } from "react";

/**
 * Small animated line-icons shown in each feature card's header. Animation is
 * driven by the `.feat-*` CSS classes in globals.css (stroke-dash draw/flow,
 * pulse, float, spin) which are disabled under `prefers-reduced-motion`.
 */
export type FeatureIconName =
  | "multisig"
  | "signers"
  | "wallets"
  | "createTx"
  | "history"
  | "pending"
  | "proposals"
  | "drep"
  | "staking";

// Lets us set the CSS custom property used by the `feat-draw` keyframe.
type DashStyle = CSSProperties & { "--dash"?: string };
const drawLen = (len: number): DashStyle => ({ "--dash": String(len) });

function Glyph({ name }: { name: FeatureIconName }) {
  switch (name) {
    case "multisig":
      return (
        <>
          <path d="M12 3l7 3v5c0 4.4-3 7.5-7 9-4-1.5-7-4.6-7-9V6l7-3z" />
          <path
            className="feat-draw"
            style={drawLen(14)}
            strokeDasharray="14"
            d="M8.8 12l2.2 2.2L15.4 10"
          />
        </>
      );
    case "signers":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.8 19c0-3 2.4-5 5.2-5 1.2 0 2.3.4 3.2 1" />
          <path
            className="feat-draw"
            style={drawLen(12)}
            strokeDasharray="12"
            d="M14.5 14.5l2.2 2.2 4-4.2"
          />
        </>
      );
    case "wallets":
      return (
        <>
          <rect x="3" y="6" width="18" height="13" rx="2.4" />
          <path d="M3 10.5h18" />
          <circle className="feat-pulse" cx="17" cy="14.8" r="1.5" />
        </>
      );
    case "createTx":
      return (
        <>
          <path className="feat-dash" d="M3 12h11.5" />
          <path d="M12 6.5l6 5.5-6 5.5" />
        </>
      );
    case "history":
      return (
        <>
          <path className="feat-dash" d="M4 7h16" />
          <path className="feat-dash" style={{ animationDelay: "0.3s" }} d="M4 12h16" />
          <path className="feat-dash" style={{ animationDelay: "0.6s" }} d="M4 17h10" />
        </>
      );
    case "pending":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          {/* Hands grouped and rotated about the clock centre (12,12). */}
          <g
            className="feat-spin"
            style={{ transformBox: "view-box", transformOrigin: "12px 12px" }}
          >
            <path d="M12 12V7.4" />
            <path d="M12 12l3 1.9" />
          </g>
        </>
      );
    case "proposals":
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4" />
          <path
            className="feat-draw"
            style={drawLen(12)}
            strokeDasharray="12"
            d="M9 14l2 2 4-4"
          />
        </>
      );
    case "drep":
      return (
        <>
          <path d="M12 8l-5 7M12 8l5 7M7 15h10" />
          <circle cx="12" cy="6" r="2" />
          <circle className="feat-pulse" cx="6.6" cy="16.5" r="1.9" />
          <circle
            className="feat-pulse"
            style={{ animationDelay: "0.6s" }}
            cx="17.4"
            cy="16.5"
            r="1.9"
          />
        </>
      );
    case "staking":
      return (
        <>
          <path
            className="feat-draw"
            style={drawLen(42)}
            strokeDasharray="42"
            d="M4 16.5l5-5 4 3 7-8"
          />
          <path d="M16 6.5h4v4" />
        </>
      );
  }
}

export function FeatureIcon({ name }: { name: FeatureIconName }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-foreground/75"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Glyph name={name} />
      </svg>
    </span>
  );
}

export default FeatureIcon;
