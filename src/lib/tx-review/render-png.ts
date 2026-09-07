import { reviewCardTree } from "./card";
import type { TxReviewSummary } from "./summary";

/**
 * Rasterize the review card to a PNG.
 *
 * Uses the `ImageResponse` that ships inside Next (`next/og`: satori for
 * layout, resvg for rasterization, a bundled Geist face) — no new dependency,
 * no system fonts, works in the plain Node runtime. The import MUST stay
 * inside the function: the module loads two WASM blobs, and nothing that
 * imports this file (the MCP registry included) may pay that at module scope.
 *
 * `next/og` is an ESM bundle that the CJS jest project cannot load; the
 * rendering test lives in the ESM project for that reason, and every other
 * test mocks this module.
 */
export async function renderReviewPng(summary: TxReviewSummary): Promise<Buffer> {
  const { element, width, height } = reviewCardTree(summary);
  const { ImageResponse } = await import("next/og");
  // satori accepts a plain {type, props} tree; the React element type is only
  // nominal here.
  const response = new ImageResponse(element as never, { width, height });
  return Buffer.from(await response.arrayBuffer());
}
