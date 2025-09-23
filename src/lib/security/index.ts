// Security configuration and utilities
export * from './rateLimit';
export * from './validation';
export * from './domains';

// Security middleware for API routes
export function createSecurityMiddleware(options: {
  maxRequests?: number;
  windowMs?: number;
  allowedMethods?: string[];
} = {}) {
  const {
    maxRequests = 10,
    windowMs = 60 * 1000,
    allowedMethods = ['GET']
  } = options;

  return async (req: any, res: any, next?: () => void) => {
    // Method validation
    if (!allowedMethods.includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Origin validation
    const { validateOrigin } = await import('./validation');
    if (!validateOrigin(req)) {
      return res.status(403).json({ error: 'Forbidden origin' });
    }
    
    // Rate limiting
    const { checkRateLimit, getClientIP } = await import('./rateLimit');
    const clientIP = getClientIP(req);
    if (!checkRateLimit(clientIP, maxRequests, windowMs)) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    
    if (next) next();
  };
}
