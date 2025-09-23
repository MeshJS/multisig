import type { NextApiRequest, NextApiResponse } from "next";

function isValidExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    // Block private/internal IP ranges
    const hostname = parsed.hostname;
    
    // Block localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return false;
    }
    
    // Block private IP ranges (RFC 1918)
    const privateRanges = [
      /^10\./,                    // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./,              // 192.168.0.0/16
      /^169\.254\./,              // Link-local
      /^::1$/,                    // IPv6 loopback
      /^fc00:/,                   // IPv6 private
      /^fe80:/,                   // IPv6 link-local
    ];
    
    if (privateRanges.some(range => range.test(hostname))) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const src = req.query.src as string | undefined;
  if (!src) {
    return res.status(400).json({ error: "Missing src parameter" });
  }
  
  if (!isValidExternalUrl(src)) {
    return res.status(400).json({ error: "Invalid or unsafe URL" });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(src, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch (${response.status})` });
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch {
    res.status(500).json({ error: "Proxy fetch failed" });
  }
}


