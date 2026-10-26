/**
 * Server-side fetch of an allow-listed URL with the limits a public endpoint
 * needs: no redirects, a byte cap, and one deadline for headers AND body.
 *
 * Used by the dApp card endpoints (`/api/local/og`, `/api/local/proxy`). They
 * check the target host against an allow-list, so the fetch itself must not
 * follow a redirect: `fetch` follows up to 20 by default, and one 302 from an
 * allowed host would land the request on a host nobody checked. The same rule
 * already holds in `/api/v1/og`.
 */

export type CappedFetchFailure =
  | "redirect"
  | "status"
  | "content_type"
  | "too_large";

export class CappedFetchError extends Error {
  constructor(
    readonly reason: CappedFetchFailure,
    message: string,
  ) {
    super(message);
    this.name = "CappedFetchError";
  }
}

/** `image/png`, `image/svg+xml; charset=utf-8`, … — a well-formed image/* type. */
export function isImageContentType(contentType: string): boolean {
  return /^image\/[a-z0-9.+-]+\s*(;|$)/i.test(contentType.trim());
}

export interface CappedFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  /**
   * What to do with a body over `maxBytes`. "truncate" suits HTML scraped for
   * <head> metadata; "reject" suits a body we pass on verbatim, where a cut-off
   * image is worse than none.
   */
  overflow: "truncate" | "reject";
  /**
   * Checked against the response before the body is read, so a rejected
   * response costs us its headers only.
   */
  acceptContentType?: (contentType: string) => boolean;
  headers?: Record<string, string>;
}

export interface CappedFetchResult {
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

export async function cappedFetch(
  url: string,
  options: CappedFetchOptions,
): Promise<CappedFetchResult> {
  const controller = new AbortController();
  // The deadline covers the body too. Clearing it once headers arrive (as the
  // old handlers did) let an upstream that trickles its body hold the function
  // open until the platform killed it.
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: options.headers,
    });

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new CappedFetchError("redirect", "Upstream redirected; redirects are not followed");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new CappedFetchError("status", `Upstream returned ${response.status}`);
    }

    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";
    if (options.acceptContentType && !options.acceptContentType(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new CappedFetchError("content_type", `Unexpected content type ${contentType}`);
    }

    const declared = Number(response.headers.get("content-length"));
    if (
      options.overflow === "reject" &&
      Number.isFinite(declared) &&
      declared > options.maxBytes
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new CappedFetchError("too_large", "Upstream body exceeds the size limit");
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.byteLength > options.maxBytes) {
          await reader.cancel().catch(() => undefined);
          if (options.overflow === "reject") {
            throw new CappedFetchError("too_large", "Upstream body exceeds the size limit");
          }
          chunks.push(value.subarray(0, options.maxBytes - received));
          received = options.maxBytes;
          truncated = true;
          break;
        }
        chunks.push(value);
        received += value.byteLength;
      }
    }

    return {
      contentType,
      body: Buffer.concat(chunks, received),
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}
