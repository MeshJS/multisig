import type { NextApiRequest, NextApiResponse } from "next";
import { Writable } from "stream";
import formidable, { multipart, type Fields } from "formidable";

import { env } from "@/env";
import { ipfsGatewayUrl } from "@/lib/ipfs";
import { getWalletSessionFromReq } from "@/lib/auth/walletSession";
import { verifyJwt } from "@/lib/verifyJwt";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * POST /api/pinata-storage/image/put — pin one image (DRep or wallet avatar)
 * to IPFS.
 *
 * Authentication is required, exactly as for its sibling
 * /api/pinata-storage/put. That endpoint was closed in 09a042a; this one was
 * left open, so anyone on the internet could pin arbitrary files to the
 * project's Pinata account and burn its quota with no record of who did it.
 *
 * The request is authorized BEFORE the body is read, and the multipart parser
 * buffers in memory with a hard 1 MB cap instead of writing to the OS temp
 * directory. Previously every request — authorized or not, of any size up to
 * formidable's 200 MB default — was streamed to a temp file that was never
 * deleted, and the 1 MB limit was only checked once the whole upload was on
 * disk.
 */

// Next's default JSON/urlencoded body parser would consume the stream before
// formidable sees it (the parse then never settles), so it must stay off.
export const config = {
  api: {
    bodyParser: false,
  },
};

/** Mirrors the dropzone's `maxSize` in ImgDragAndDrop. */
const MAX_IMAGE_BYTES = 1024 * 1024;

/**
 * Headroom over the file cap for the multipart framing and the two short text
 * fields. A declared Content-Length above this is refused before reading.
 */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

// formidable codes for its own size caps, so other 413s (too many files or
// fields) don't get reported as "file too large".
const FORMIDABLE_SIZE_ERRORS = new Set([1009, 1016]);

interface PinataResponse {
  data: {
    id: string;
    name: string;
    cid: string;
    size: number;
    number_of_files: number;
    mime_type: string;
    group_id: string | null;
  };
}

type ParsedUpload = {
  fields: Fields;
  file: { buffer: Buffer; mimetype: string | null } | null;
};

class UploadRejected extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Parse the multipart body into memory. Exactly one file part is allowed and it
 * must be named `file`; exceeding the size cap aborts the parse as soon as the
 * cap is crossed, not after the upload finishes.
 *
 * Only the multipart plugin is enabled: formidable's octet-stream, JSON and
 * urlencoded plugins bypass maxFiles/maxFileSize (octet-stream streams the
 * whole body into the file handler) and would let a caller buffer an unbounded
 * body. There is deliberately no `filter`, because parts a filter drops count
 * toward no limit at all.
 */
function parseUpload(req: NextApiRequest): Promise<ParsedUpload> {
  const chunks: Buffer[] = [];
  let mimetype: string | null = null;
  let fileField: string | null = null;
  let sawFile = false;

  const form = formidable({
    enabledPlugins: [multipart],
    maxFiles: 1,
    maxFileSize: MAX_IMAGE_BYTES,
    maxTotalFileSize: MAX_IMAGE_BYTES,
    maxFields: 10,
    maxFieldsSize: 16 * 1024,
    fileWriteStreamHandler: (file) => {
      sawFile = true;
      // @types/formidable types this argument as VolatileFile without
      // `mimetype`; at runtime it is the file whose part headers are parsed.
      mimetype = (file as { mimetype?: string | null } | undefined)?.mimetype ?? null;
      return new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });
    },
  });

  form.on("fileBegin", (formName) => {
    fileField = formName;
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err: unknown, fields) => {
      if (err) {
        // FormidableError carries the HTTP status it maps to.
        const { code, httpCode } = err as { code?: unknown; httpCode?: unknown };
        if (typeof code === "number" && FORMIDABLE_SIZE_ERRORS.has(code)) {
          reject(new UploadRejected("File size exceeds 1MB limit", 413));
        } else if (httpCode === 413) {
          reject(new UploadRejected("Too many files or fields", 413));
        } else {
          reject(new UploadRejected("Malformed upload", 400));
        }
        return;
      }
      if (sawFile && fileField !== "file") {
        reject(new UploadRejected("The image must be sent as the `file` field", 400));
        return;
      }
      resolve({
        fields,
        file: sawFile ? { buffer: Buffer.concat(chunks), mimetype } : null,
      });
    });
  });
}

function firstField(fields: Fields, name: string): string | null {
  const raw = fields[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (
    !applyRateLimit(req, res, { keySuffix: "pinata/image/put", maxRequests: 20 })
  ) {
    return;
  }

  const session = getWalletSessionFromReq(req);
  const hasWalletSession = (session?.wallets?.length ?? 0) > 0;
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const hasBearer = bearer ? verifyJwt(bearer) !== null : false;

  if (!hasWalletSession && !hasBearer) {
    return res
      .status(401)
      .json({ error: "Unauthorized - connect and authorize a wallet first" });
  }

  const contentType = req.headers["content-type"] ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return res.status(415).json({ error: "Expected multipart/form-data" });
  }
  // A Content-Length is required, not just checked: Node stops reading the
  // body at the declared length, so this is what bounds the bytes we accept.
  // Without it (a chunked upload) formidable's caps only count part bodies —
  // a part header can grow without limit. Browsers always send the length for
  // a FormData body, so the in-app caller is unaffected.
  const lengthHeader = req.headers["content-length"];
  if (lengthHeader === undefined) {
    return res.status(411).json({ error: "Content-Length is required" });
  }
  const declaredLength = Number(lengthHeader);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "File size exceeds 1MB limit" });
  }

  let upload: ParsedUpload;
  try {
    upload = await parseUpload(req);
  } catch (err) {
    if (err instanceof UploadRejected) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }

  if (!upload.file || upload.file.buffer.byteLength === 0) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  if (!firstField(upload.fields, "shortHash")) {
    return res.status(400).json({ error: "shortHash is required" });
  }
  const filename = firstField(upload.fields, "filename");
  if (!filename) {
    return res.status(400).json({ error: "filename is required" });
  }
  // The pin is public under the project's account; keep it to what the
  // dropzone accepts (`image/*`). The type is client-declared, so this stops
  // casual misuse (pinning HTML or binaries), not a determined caller.
  const mimetype = upload.file.mimetype ?? "";
  if (!mimetype.toLowerCase().startsWith("image/")) {
    return res.status(415).json({ error: "Only image uploads are accepted" });
  }

  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(upload.file.buffer)], { type: mimetype }),
      filename,
    );
    formData.append("network", "public");

    const pinataResponse = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PINATA_JWT}`,
      },
      body: formData,
    });

    if (!pinataResponse.ok) {
      const errorText = await pinataResponse.text();
      console.error("Pinata upload error:", errorText);
      return res.status(pinataResponse.status).json({
        error: "Pinata upload failed",
        details: errorText,
      });
    }

    const pinataData = (await pinataResponse.json()) as PinataResponse;

    // Return a reliable gateway URL (dedicated Pinata gateway when configured).
    return res.status(200).json({
      url: ipfsGatewayUrl(pinataData.data.cid),
      cid: pinataData.data.cid,
      id: pinataData.data.id,
    });
  } catch (err) {
    console.error("File upload error:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
