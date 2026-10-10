import { env } from "@/env";
import { ipfsGatewayUrl } from "@/lib/ipfs";

/**
 * Server-side Pinata upload.
 *
 * Extracted from `src/pages/api/pinata-storage/put.ts` so callers that already
 * hold an authenticated, authorized request can pin content without a loopback
 * HTTP hop through that route.
 */

type PinataResponse = {
  data: { id: string; cid: string };
};

export type PinnedFile = {
  url: string;
  cid: string;
  id: string;
};

/** Cap on what we will pin in one call. Rationale documents are small. */
export const MAX_PIN_BYTES = 256 * 1024;

export class PinataUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: string,
  ) {
    super(message);
    this.name = "PinataUploadError";
  }
}

/**
 * Pin `value` under `filename` and return a gateway URL.
 *
 * The exact bytes of `value` are what get pinned — callers that also hash the
 * content must hash the identical string, or the anchor will not verify against
 * the fetched document.
 */
export async function pinJsonLd(
  filename: string,
  value: string,
): Promise<PinnedFile> {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_PIN_BYTES) {
    throw new PinataUploadError(
      `Document exceeds the ${MAX_PIN_BYTES}-byte pin limit`,
      413,
    );
  }

  const formData = new FormData();
  const blob = new Blob([Buffer.from(value, "utf-8")], {
    type: "application/ld+json",
  });
  // Strip any folder structure; Pinata takes a flat filename.
  formData.append("file", blob, filename.split("/").pop() || filename);
  formData.append("network", "public");

  const response = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.PINATA_JWT}` },
    body: formData,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new PinataUploadError("Pinata upload failed", response.status, details);
  }

  const pinata = (await response.json()) as PinataResponse;
  return {
    url: ipfsGatewayUrl(pinata.data.cid),
    cid: pinata.data.cid,
    id: pinata.data.id,
  };
}
