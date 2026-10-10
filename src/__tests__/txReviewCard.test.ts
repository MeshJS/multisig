import { describe, expect, it } from "@jest/globals";

import {
  CARD_FOOTER_PREVIEW,
  CARD_MAX_HEIGHT,
  CARD_MIN_HEIGHT,
  CARD_WIDTH,
  collectCardText,
  reviewCardTree,
  type CardElement,
} from "@/lib/tx-review/card";
import type { TxReviewSummary } from "@/lib/tx-review/summary";

/**
 * The card is rendered by satori, which has hard rules the CJS project
 * cannot check by rendering (that test is in the ESM project). What it can
 * check is the tree: flex on every multi-child box, Latin-only text for the
 * single bundled face, the boundary statement present, and a sane canvas.
 */

function summary(overrides: Partial<TxReviewSummary> = {}): TxReviewSummary {
  return {
    kind: "preview",
    wallet: { id: "w1", name: "Treasury", address: "addr_test1qpwallet", network: "preprod" },
    threshold: { required: 2, total: 3, type: "atLeast" },
    signatures: { signed: [], rejected: [], remaining: 2 },
    description: "Rent",
    metadataMessage: "Sept",
    recipients: [
      {
        address: "addr_test1qplandlord",
        label: "Landlord",
        partyType: "contact",
        amounts: [{ unit: "lovelace", quantity: "12500000", display: "12.5 ADA" }],
      },
      { address: "addr_test1qpunknown", label: "", partyType: "unknown", amounts: [] },
    ],
    change: [{ unit: "lovelace", quantity: "1", display: "39.16 ADA" }],
    inputs: { count: 2, total: [], unresolved: 0 },
    fee: { unit: "lovelace", quantity: "180000", display: "0.18 ADA" },
    deposit: null,
    actions: [
      {
        kind: "vote",
        label: "Vote: Yes",
        title: "Increase treasury cap",
        detail: "cccccccc…cccc#0",
        rationale: { status: "will-publish-on-confirm", excerpt: "Because." },
      },
    ],
    txHash: "ab".repeat(32),
    sizeBytes: 900,
    warnings: ["Token-only output — min ADA will be added automatically at build time."],
    generatedAt: "2026-09-07T12:00:00.000Z",
    ...overrides,
  };
}

function walk(element: CardElement | string, visit: (el: CardElement) => void) {
  if (typeof element === "string") return;
  visit(element);
  const children = element.props.children;
  if (children === undefined) return;
  for (const child of Array.isArray(children) ? children : [children]) walk(child, visit);
}

describe("review card tree", () => {
  it("fits the canvas bounds and the fixed width", () => {
    const { width, height } = reviewCardTree(summary());
    expect(width).toBe(CARD_WIDTH);
    expect(height).toBeGreaterThanOrEqual(CARD_MIN_HEIGHT);
    expect(height).toBeLessThanOrEqual(CARD_MAX_HEIGHT);
    // Content grows the card.
    const tall = reviewCardTree(
      summary({ recipients: Array.from({ length: 30 }, () => summary().recipients[0]!) }),
    );
    expect(tall.height).toBeGreaterThan(height);
    expect(tall.height).toBeLessThanOrEqual(CARD_MAX_HEIGHT);
  });

  it("gives every multi-child box display:flex (a satori requirement)", () => {
    walk(reviewCardTree(summary()).element, (el) => {
      const children = el.props.children;
      const count = Array.isArray(children) ? children.length : children === undefined ? 0 : 1;
      if (count > 1) {
        expect((el.props.style as { display?: string })?.display).toBe("flex");
      }
    });
  });

  it("paints only glyphs the bundled Latin face can render", () => {
    const text = collectCardText(reviewCardTree(summary()).element).join("\n");
    expect(text).not.toContain("₳");
    // No emoji / astral-plane characters.
    expect(text).not.toMatch(/[\u{1F000}-\u{1FFFF}]/u);
  });

  it("states that nothing is signed or broadcast on a preview", () => {
    const text = collectCardText(reviewCardTree(summary()).element);
    expect(text).toContain(CARD_FOOTER_PREVIEW);
    expect(text).toContain("UNSIGNED PREVIEW");
    expect(text).toContain("Landlord");
    expect(text).toContain("12.5 ADA");
    expect(text).toContain("Unknown address");
    expect(text.some((t) => t.includes("Increase treasury cap"))).toBe(true);
    expect(text.some((t) => t.includes("published to IPFS on confirm"))).toBe(true);
    expect(text.some((t) => t.startsWith("Warning:"))).toBe(true);
  });

  it("omits the recipient section and shows the change for a certificate-only transaction", () => {
    const text = collectCardText(
      reviewCardTree(
        summary({
          recipients: [],
          change: [{ unit: "lovelace", quantity: "5254185978", display: "5,254.185978 ADA" }],
          deposit: { unit: "lovelace", quantity: "2000000", display: "2 ADA" },
          actions: [{ kind: "certificate", label: "Stake Delegation", title: "[ANGEL] ANGEL stake pool" }],
        }),
      ).element,
    );
    expect(text.some((t) => /recipient/i.test(t))).toBe(false);
    expect(text).toContain("5,254.185978 ADA");
    expect(text).not.toContain("none");
  });

  it("says none when nothing returns to the wallet", () => {
    const text = collectCardText(reviewCardTree(summary({ change: [] })).element);
    expect(text).toContain("none");
  });

  it("shows signature progress on a pending card", () => {
    const text = collectCardText(
      reviewCardTree(
        summary({
          kind: "pending",
          signatures: { signed: [{ address: "a", label: "Alice" }], rejected: [], remaining: 1 },
        }),
      ).element,
    );
    expect(text).toContain("PENDING · 1 OF 2 SIGNED");
    expect(text.some((t) => t.includes("Signed: Alice"))).toBe(true);
    expect(text.some((t) => t.includes("Awaiting 1 more signature "))).toBe(true);
    expect(text).not.toContain(CARD_FOOTER_PREVIEW);
  });
});
