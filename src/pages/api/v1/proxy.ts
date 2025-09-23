import type { NextApiRequest, NextApiResponse } from "next";

// Allow-list of trusted domains for image proxying
const ALLOWED_DOMAINS = [
  'fluidtokens.com',
  'aquarium-qa.fluidtokens.com',
  'minswap-multisig-dev.fluidtokens.com',
  // Add more trusted domains as needed
];

function isAllowedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    // Check if hostname is in allow-list
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const src = req.query.src as string | undefined;
  if (!src) {
    return res.status(400).json({ error: "Missing src parameter" });
  }
  
  if (!isAllowedDomain(src)) {
    return res.status(400).json({ error: "Domain not allowed" });
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


