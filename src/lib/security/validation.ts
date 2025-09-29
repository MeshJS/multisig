// Import CORS configuration
function getAllowedOrigins(): string[] {
  const rawOrigins = process.env.CORS_ORIGINS || "";
  return rawOrigins === "*" ? ["*"] : rawOrigins.split(",").map((o) => o.trim());
}

export function validateOrigin(req: any): boolean {
  const origin = req.headers.origin;
  
  // Allow requests from same origin (no origin header)
  if (!origin) {
    return true;
  }
  
  const allowedOrigins = getAllowedOrigins();
  
  // Wildcard origin
  if (allowedOrigins.includes("*")) {
    return true;
  }
  
  // Check for exact match first
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  
  // Check for subdomain matches
  for (const allowedOrigin of allowedOrigins) {
    try {
      const allowedUrl = new URL(allowedOrigin);
      const requestUrl = new URL(origin);
      
      // Check if the request origin is a subdomain of the allowed origin
      if (requestUrl.hostname.endsWith('.' + allowedUrl.hostname) || 
          requestUrl.hostname === allowedUrl.hostname) {
        return true;
      }
    } catch (error) {
      console.warn(`Invalid URL format for origin: ${allowedOrigin}`, error);
    }
  }
  
  return false;
}

export function validateUrlParameter(url: string | undefined, paramName: string): { isValid: boolean; error?: string } {
  if (!url) {
    return { isValid: false, error: `Missing ${paramName} parameter` };
  }
  
  if (typeof url !== 'string' || url.length > 2048) {
    return { isValid: false, error: `Invalid ${paramName} parameter` };
  }
  
  return { isValid: true };
}
