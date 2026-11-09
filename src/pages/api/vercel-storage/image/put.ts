import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: false, // Required for file uploads
  },
};

/**
 * POST /api/vercel-storage/image/put — not in service.
 *
 * Vercel Blob storage is not configured and nothing in the app calls this
 * route (image uploads go to /api/pinata-storage/image/put). It used to parse
 * the whole multipart upload — streamed to an OS temp file that was never
 * deleted, up to formidable's 200 MB default, with no authentication — and only
 * then answer 501. It now answers 501 without reading the body, so an
 * unauthenticated caller cannot fill the server's disk through it.
 *
 * If Blob storage is ever enabled, rebuild this on the pinata handler's model:
 * authenticate first, then parse in memory with a size cap.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(501).json({ error: "Vercel blob storage not configured" });
}
