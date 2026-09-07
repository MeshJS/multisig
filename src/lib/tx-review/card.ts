import { getFirstAndLast } from "@/utils/strings";
import type { TxReviewSummary } from "./summary";

/**
 * The review card as a plain element tree for satori (via `next/og`).
 *
 * Kept free of React so the CJS test project can assert on the layout
 * without loading the WASM renderer. Satori rules observed throughout: a
 * div with more than one child must be `display: flex`; the bundled font is
 * Latin-only (so "ADA", never "₳"; no emoji); there is a single regular
 * weight, so hierarchy comes from size and colour, not boldness.
 *
 * The card is a statement of fact for a human about to sign, so it repeats
 * the boundary in its own pixels: nothing here has been signed or broadcast.
 */

export const CARD_WIDTH = 1200;
export const CARD_MIN_HEIGHT = 420;
export const CARD_MAX_HEIGHT = 2400;

export const CARD_FOOTER_PREVIEW =
  "Nothing has been signed or broadcast. Signers approve in the Mesh Multisig app.";

export type CardElement = {
  type: string;
  props: Record<string, unknown> & { children?: CardElement | string | (CardElement | string)[] };
};

const COLORS = {
  bg: "#0b1220",
  panel: "#111a2e",
  border: "#1f2a44",
  text: "#f1f5f9",
  muted: "#94a3b8",
  faint: "#64748b",
  amber: "#f59e0b",
  amberInk: "#1f1300",
  green: "#22c55e",
  red: "#ef4444",
  blue: "#60a5fa",
};

const h = (
  type: string,
  props: Record<string, unknown>,
  ...children: (CardElement | string | null | undefined | false)[]
): CardElement => {
  const kids = children.filter((c): c is CardElement | string => !!c || c === "");
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
};

// `flexShrink: 0` everywhere: the canvas height is an estimate, and if the
// content ever exceeds it, yoga would otherwise squash the text-only boxes to
// zero height (lines overlap, boxes lose their text) rather than overflow.
// Overflowing the bottom edge is the honest failure; squashing is not.
const row = (style: Record<string, unknown>, ...children: (CardElement | string | null | false)[]) =>
  h("div", { style: { display: "flex", flexDirection: "row", flexShrink: 0, ...style } }, ...children);
const col = (style: Record<string, unknown>, ...children: (CardElement | string | null | false)[]) =>
  h("div", { style: { display: "flex", flexDirection: "column", flexShrink: 0, ...style } }, ...children);
const text = (value: string, style: Record<string, unknown> = {}) =>
  h("div", { style: { display: "flex", flexShrink: 0, ...style } }, value);

function pill(label: string, bg: string, ink: string): CardElement {
  return text(label, {
    background: bg,
    color: ink,
    fontSize: 20,
    letterSpacing: 1,
    padding: "8px 16px",
    borderRadius: 999,
  });
}

function sectionTitle(label: string): CardElement {
  return text(label.toUpperCase(), {
    fontSize: 18,
    letterSpacing: 2,
    color: COLORS.faint,
    marginBottom: 10,
  });
}

/**
 * Per-section heights, measured from rendered cards and rounded UP: the
 * boxes never shrink (see the helpers), so an under-estimate clips the
 * footer while an over-estimate only adds dark space above it.
 */
export function estimateCardHeight(summary: TxReviewSummary): number {
  let height = 88 + 104; // canvas padding + header
  if (summary.description) {
    height += 80 + 32 * Math.floor(summary.description.length / 70);
  }
  if (summary.recipients.length > 0) {
    height += 58; // section title + top margin
    for (const recipient of summary.recipients) {
      height += 52 + Math.max(1, recipient.amounts.length) * 36;
    }
  }
  if (summary.actions.length > 0) {
    height += 58;
    for (const action of summary.actions) {
      height += 58 + (action.rationale?.status === "will-publish-on-confirm" ? 34 : 0);
    }
  }
  const stats = 3 + (summary.deposit ? 1 : 0) + (summary.sizeBytes ? 1 : 0);
  height += 122 + (stats > 5 ? 90 : 0); // totals panel (+ a wrapped row)
  if (summary.metadataMessage) height += 42;
  if (summary.kind === "pending") height += 42;
  if (summary.warnings.length > 0) height += 16 + summary.warnings.length * 34;
  height += 112; // hash + footer banner
  height += 20; // slack
  return Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, height));
}

export function reviewCardTree(summary: TxReviewSummary): {
  element: CardElement;
  width: number;
  height: number;
} {
  const height = estimateCardHeight(summary);
  const isPreview = summary.kind === "preview";
  const signedCount = summary.signatures.signed.length;

  const header = row(
    { justifyContent: "space-between", alignItems: "flex-start" },
    col(
      { gap: 8 },
      text(summary.wallet.name || "Multisig wallet", { fontSize: 38, color: COLORS.text }),
      text(
        `${summary.wallet.network === "mainnet" ? "Mainnet" : "Preprod"} · ${summary.threshold.required} of ${summary.threshold.total} signatures required · ${getFirstAndLast(summary.wallet.address, 14, 8)}`,
        { fontSize: 20, color: COLORS.muted },
      ),
    ),
    col(
      { alignItems: "flex-end", gap: 8 },
      isPreview
        ? pill("UNSIGNED PREVIEW", COLORS.amber, COLORS.amberInk)
        : pill(
            `PENDING · ${signedCount} OF ${summary.threshold.required} SIGNED`,
            signedCount >= summary.threshold.required ? COLORS.green : COLORS.amber,
            COLORS.amberInk,
          ),
    ),
  );

  const description = summary.description
    ? text(`"${summary.description}"`, {
        fontSize: 24,
        color: COLORS.text,
        marginTop: 26,
        padding: "12px 18px",
        background: COLORS.panel,
        borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
      })
    : null;

  const recipients =
    summary.recipients.length > 0
      ? col(
          { marginTop: 28 },
          sectionTitle(summary.recipients.length === 1 ? "Recipient" : "Recipients"),
          ...summary.recipients.map((recipient) =>
            row(
              {
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "12px 0",
                borderBottom: `1px solid ${COLORS.border}`,
              },
              col(
                { gap: 4, maxWidth: 640 },
                text(recipient.label || "Unknown address", {
                  fontSize: 26,
                  color: recipient.label ? COLORS.text : COLORS.amber,
                }),
                text(getFirstAndLast(recipient.address, 22, 12), {
                  fontSize: 18,
                  color: COLORS.faint,
                }),
              ),
              col(
                { alignItems: "flex-end", gap: 2 },
                ...(recipient.amounts.length > 0
                  ? recipient.amounts.map((amount) =>
                      text(amount.display, { fontSize: 28, color: COLORS.text }),
                    )
                  : [text("no amount", { fontSize: 22, color: COLORS.red })]),
              ),
            ),
          ),
        )
      : null;

  const actions =
    summary.actions.length > 0
      ? col(
          { marginTop: 28 },
          sectionTitle("Actions"),
          ...summary.actions.map((action) =>
            col(
              { padding: "10px 0", borderBottom: `1px solid ${COLORS.border}`, gap: 4 },
              row(
                { gap: 14, alignItems: "baseline" },
                text(action.label, {
                  fontSize: 26,
                  color: action.kind === "vote" ? COLORS.blue : COLORS.green,
                }),
                action.title ? text(action.title.slice(0, 80), { fontSize: 24, color: COLORS.text }) : null,
                action.detail ? text(action.detail, { fontSize: 18, color: COLORS.faint }) : null,
              ),
              action.rationale?.status === "will-publish-on-confirm"
                ? text(`Rationale (published to IPFS on confirm): "${action.rationale.excerpt}"`, {
                    fontSize: 18,
                    color: COLORS.muted,
                  })
                : action.rationale?.status === "anchored"
                  ? text(`Rationale: ${action.rationale.url.slice(0, 90)}`, {
                      fontSize: 18,
                      color: COLORS.muted,
                    })
                  : null,
            ),
          ),
        )
      : null;

  const stat = (label: string, value: string) =>
    col(
      { gap: 4, minWidth: 160 },
      text(label.toUpperCase(), { fontSize: 15, letterSpacing: 2, color: COLORS.faint }),
      text(value, { fontSize: 24, color: COLORS.text }),
    );

  const totals = row(
    {
      marginTop: 28,
      gap: 28,
      padding: "16px 20px",
      background: COLORS.panel,
      borderRadius: 10,
      border: `1px solid ${COLORS.border}`,
      flexWrap: "wrap",
    },
    stat("Fee", summary.fee?.display ?? "—"),
    summary.deposit ? stat("Deposit", summary.deposit.display) : null,
    stat(
      "Change to this wallet",
      summary.change.length > 0 ? summary.change.map((a) => a.display).join(" + ") : "none",
    ),
    stat(
      "Inputs",
      `${summary.inputs.count}${summary.inputs.unresolved > 0 ? ` (${summary.inputs.unresolved} unresolved)` : ""}`,
    ),
    summary.sizeBytes ? stat("Size", `${(summary.sizeBytes / 1024).toFixed(1)} KB`) : null,
  );

  const metadata = summary.metadataMessage
    ? text(`On-chain message: "${summary.metadataMessage}"`, {
        fontSize: 20,
        color: COLORS.muted,
        marginTop: 16,
      })
    : null;

  const signatures =
    summary.kind === "pending"
      ? row(
          { marginTop: 16, gap: 24 },
          text(
            `Signed: ${summary.signatures.signed.length > 0 ? summary.signatures.signed.map((s) => s.label).join(", ") : "nobody yet"}`,
            { fontSize: 20, color: COLORS.green },
          ),
          summary.signatures.rejected.length > 0
            ? text(`Rejected: ${summary.signatures.rejected.map((s) => s.label).join(", ")}`, {
                fontSize: 20,
                color: COLORS.red,
              })
            : null,
        )
      : null;

  const warnings =
    summary.warnings.length > 0
      ? col(
          { marginTop: 16, gap: 6 },
          ...summary.warnings.map((warning) =>
            text(`Warning: ${warning}`, { fontSize: 19, color: COLORS.amber }),
          ),
        )
      : null;

  const footer = col(
    { marginTop: "auto", gap: 10, paddingTop: 20 },
    text(`Tx hash ${summary.txHash}`, { fontSize: 16, color: COLORS.faint }),
    text(
      isPreview
        ? CARD_FOOTER_PREVIEW
        : `Awaiting ${summary.signatures.remaining} more signature${summary.signatures.remaining === 1 ? "" : "s"} in the Mesh Multisig app. Nothing is broadcast until the threshold is met.`,
      {
        fontSize: 20,
        color: COLORS.amberInk,
        background: COLORS.amber,
        padding: "12px 18px",
        borderRadius: 10,
      },
    ),
  );

  const element = col(
    {
      width: "100%",
      height: "100%",
      padding: "44px 56px",
      background: COLORS.bg,
      color: COLORS.text,
      fontFamily: "Geist, sans-serif",
    },
    header,
    description,
    recipients,
    actions,
    totals,
    metadata,
    signatures,
    warnings,
    footer,
  );

  return { element, width: CARD_WIDTH, height };
}

/** Every string the card will paint, for tests that assert on glyph safety. */
export function collectCardText(element: CardElement | string): string[] {
  if (typeof element === "string") return [element];
  const children = element.props.children;
  if (children === undefined) return [];
  const list = Array.isArray(children) ? children : [children];
  return list.flatMap((child) => collectCardText(child));
}
