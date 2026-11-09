import { describe, expect, it, jest } from "@jest/globals";

import { renderReviewPng } from "@/lib/tx-review/render-png";
import { CARD_WIDTH, estimateCardHeight } from "@/lib/tx-review/card";
import type { TxReviewSummary } from "@/lib/tx-review/summary";
import { warningPages } from "@/lib/tx-review/card";
import fs from "node:fs";
import path from "node:path";

/**
 * ESM project only: `next/og` is an ESM bundle (import.meta.url for its
 * WASM and font), which the CJS project cannot load. This is the one test
 * that proves the card actually rasterizes with what ships inside Next.
 */

jest.setTimeout(30_000);

const summary: TxReviewSummary = {
  kind: "preview",
  wallet: {
    id: "w1",
    name: "Treasury",
    address: "addr_test1qpwallet0000000000000000",
    network: "preprod",
  },
  threshold: { required: 2, total: 3, type: "atLeast" },
  signatures: { signed: [], rejected: [], remaining: 2 },
  description: "Rent for September",
  metadataMessage: "Sept rent",
  recipients: [
    {
      address: "addr_test1qplandlord00000000000000000000",
      label: "Landlord",
      partyType: "contact",
      amounts: [
        { unit: "lovelace", quantity: "12500000", display: "12.5 ADA" },
      ],
    },
  ],
  change: [{ unit: "lovelace", quantity: "39160000", display: "39.16 ADA" }],
  inputs: { count: 2, total: [], unresolved: 0 },
  fee: { unit: "lovelace", quantity: "180000", display: "0.18 ADA" },
  deposit: null,
  actions: [
    {
      kind: "certificate",
      label: "Stake Delegation",
      title: "[MESH] Mesh Pool",
    },
  ],
  txHash: "ab".repeat(32),
  sizeBytes: 900,
  warnings: [],
  generatedAt: "2026-09-07T12:00:00.000Z",
};

/** Width/height straight from the PNG IHDR chunk — no image library. */
function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("renderReviewPng", () => {
  it("rasterizes all long warning pages without clipping token identities or amounts", async () => {
    const warning =
      "Output 1: Anyone can spend funds sent to this script.\nMainnet: real ADA and tokens are at risk.\nAddress: addr1w" +
      "a".repeat(100) +
      "\n9007199254740993 base units - " +
      "44".repeat(28) +
      "00ff";
    const pages = warningPages(Array.from({ length: 15 }, () => warning));
    expect(pages.length).toBeGreaterThan(1);
    const directory = path.join(
      process.cwd(),
      "ci-artifacts",
      "tx-review-risk",
    );
    fs.mkdirSync(directory, { recursive: true });
    for (const page of pages) {
      const png = await renderReviewPng(summary, page);
      expect(pngSize(png).height).toBeLessThanOrEqual(2400);
      expect(png.length).toBeGreaterThan(10_000);
      fs.writeFileSync(path.join(directory, `warnings-${page.page}.png`), png);
    }
  });
  it("rasterizes the card to a PNG of the computed size", async () => {
    const png = await renderReviewPng(summary);
    expect(png.length).toBeGreaterThan(10_000);
    expect(pngSize(png)).toEqual({
      width: CARD_WIDTH,
      height: estimateCardHeight(summary),
    });
  });
});
