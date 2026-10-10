import { promises as dns } from "dns";
import net from "net";

/**
 * SSRF guards for server-side fetches of caller-supplied URLs.
 *
 * Extracted from `src/pages/api/v1/og.ts` so the OG metadata fetcher and the
 * OAuth Client ID Metadata Document fetcher share one implementation. Two copies
 * of an address-range blocklist is how one of them ends up stale.
 */

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}

/** Unknown or unparseable input is treated as private — fail closed. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

/**
 * Reject a hostname that is, or resolves to, a private/loopback address.
 *
 * Note this is resolve-then-check, so it does not close the DNS-rebinding window
 * between this check and the socket connect. It blocks the common case
 * (attacker names an internal host or the cloud metadata endpoint); a fully
 * rebinding-proof fetch needs connection-level pinning.
 */
export async function assertSafeHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Blocked: private/loopback address");
    }
    return;
  }

  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new Error("Blocked: DNS resolution failed");
  }
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new Error("Blocked: resolves to private/loopback address");
    }
  }
}
