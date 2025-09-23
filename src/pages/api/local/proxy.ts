import type { NextApiRequest, NextApiResponse } from "next";
import { checkRateLimit, getClientIP } from "@/lib/security/rateLimit";
import { validateOrigin, validateUrlParameter } from "@/lib/security/validation";
import { isAllowedDomain } from "@/lib/security/domains";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Validate origin
  if (!validateOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  
  // Rate limiting (higher limits for development)
  const clientIP = getClientIP(req);
  const isDevelopment = process.env.NODE_ENV === 'development';
  const maxRequests = isDevelopment ? 200 : 20; // 200/min in dev, 20/min in prod
  if (!checkRateLimit(clientIP, maxRequests, 60 * 1000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  const src = req.query.src as string | undefined;
  const srcValidation = validateUrlParameter(src, 'src');
  if (!srcValidation.isValid) {
    return res.status(400).json({ error: srcValidation.error });
  }
  
  // At this point, src is guaranteed to be a string
  const validatedSrc = src as string;
  
  if (!isAllowedDomain(validatedSrc)) {
    return res.status(400).json({ error: "Domain not allowed" });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(validatedSrc, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
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


