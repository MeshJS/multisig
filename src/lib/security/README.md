# Security Module

This module provides centralized security utilities for API endpoints, including rate limiting, origin validation, domain allow-listing, and input validation.

## Architecture

The security module is organized into focused, reusable components:

```
src/lib/security/
├── index.ts          # Main exports and middleware factory
├── rateLimit.ts      # Rate limiting utilities
├── validation.ts     # Input and origin validation
├── domains.ts        # Domain allow-list management
└── README.md         # This documentation
```

## Components

### Rate Limiting (`rateLimit.ts`)

Provides configurable rate limiting with sliding window implementation.

**Functions:**
- `checkRateLimit(ip, maxRequests, windowMs)` - Check if request is within rate limit
- `getClientIP(req)` - Extract client IP from request headers

**Usage:**
```typescript
import { checkRateLimit, getClientIP } from "@/lib/security/rateLimit";

const clientIP = getClientIP(req);
if (!checkRateLimit(clientIP, 10, 60 * 1000)) {
  return res.status(429).json({ error: 'Too many requests' });
}
```

**Configuration:**
- `maxRequests`: Maximum requests per window (default: 10)
- `windowMs`: Time window in milliseconds (default: 60000 = 1 minute)

**Development Mode:**
- **Higher Limits**: Automatically uses 10x higher limits in development
- **Disable Option**: Set `DISABLE_RATE_LIMIT=true` to bypass rate limiting entirely in development

### Validation (`validation.ts`)

Handles input validation and origin checking for CORS protection.

**Functions:**
- `validateOrigin(req)` - Check if request origin is allowed
- `validateUrlParameter(url, paramName)` - Validate URL parameters

**Usage:**
```typescript
import { validateOrigin, validateUrlParameter } from "@/lib/security/validation";

// Origin validation
if (!validateOrigin(req)) {
  return res.status(403).json({ error: 'Forbidden origin' });
}

// URL parameter validation
const validation = validateUrlParameter(url, 'url');
if (!validation.isValid) {
  return res.status(400).json({ error: validation.error });
}
```

**Allowed Origins:**
- Configured via `CORS_ORIGINS` environment variable
- Supports wildcard (`*`) for development
- Supports comma-separated list of origins
- Supports subdomain matching (e.g., `*.yourdomain.com`)

### Domain Management (`domains.ts`)

Centralized allow-list for trusted domains to prevent SSRF attacks.

**Exports:**
- `ALLOWED_DOMAINS` - Array of trusted domain names (with subdomain support)
- `ALLOWED_HOSTNAMES` - Array of exact hostnames for CodeQL compliance
- `isAllowedDomain(url)` - Check if URL domain is in allow-list

**Usage:**
```typescript
import { isAllowedDomain, ALLOWED_DOMAINS, ALLOWED_HOSTNAMES } from "@/lib/security/domains";

// Check domain (with subdomain support)
if (!isAllowedDomain(url)) {
  return res.status(400).json({ error: "Domain not allowed" });
}

// Strict hostname check (CodeQL compliant)
const hostname = new URL(url).hostname.toLowerCase();
if (!ALLOWED_HOSTNAMES.includes(hostname)) {
  return res.status(400).json({ error: "Domain not allowed" });
}

// Add new domain
ALLOWED_DOMAINS.push('newdomain.com');
ALLOWED_HOSTNAMES.push('newdomain.com');
```

**Current Allowed Domains:**
- `fluidtokens.com`
- `aquarium-qa.fluidtokens.com`
- `minswap-multisig-dev.fluidtokens.com`

**Domain vs Hostname:**
- **`ALLOWED_DOMAINS`**: Supports subdomain matching (e.g., `*.fluidtokens.com`)
- **`ALLOWED_HOSTNAMES`**: Exact hostname matching only (CodeQL compliant)

### Security Middleware (`index.ts`)

Factory function to create reusable security middleware.

**Usage:**
```typescript
import { createSecurityMiddleware } from "@/lib/security";

const security = createSecurityMiddleware({
  maxRequests: 15,
  windowMs: 30 * 1000,
  allowedMethods: ['GET', 'POST']
});

// Apply to API route
export default async function handler(req, res) {
  await security(req, res);
  // Your API logic here
}
```

## API Endpoints

### OpenGraph API (`/api/local/og`)

Fetches OpenGraph and Twitter Card metadata from trusted domains.

**Endpoint:** `GET /api/local/og?url=<encoded-url>`

**Response:**
```json
{
  "title": "Page Title",
  "description": "Page Description", 
  "image": "/api/local/proxy?src=...",
  "favicon": "/api/local/proxy?src=..."
}
```

**Security Features:**
- Rate limit: 10 requests/minute per IP (production), 100 requests/minute (development)
- Origin validation
- Domain allow-list
- URL parameter validation

### Image Proxy API (`/api/local/proxy`)

Proxies images from trusted domains to avoid CORS issues.

**Endpoint:** `GET /api/local/proxy?src=<encoded-image-url>`

**Response:** Image binary data with appropriate headers

**Security Features:**
- Rate limit: 20 requests/minute per IP (production), 200 requests/minute (development)
- Origin validation
- Domain allow-list
- URL parameter validation

## Security Features

### 1. SSRF Protection
- **Domain Allow-List**: Only approved domains can be accessed
- **Strict Hostname Validation**: CodeQL-compliant exact hostname matching
- **Protocol Restriction**: Only HTTP/HTTPS allowed
- **Private IP Blocking**: Prevents access to internal networks
- **Multi-Layer Validation**: Both flexible domain matching and strict hostname checking

### 2. Rate Limiting
- **Per-IP Limits**: Prevents abuse from individual IPs
- **Sliding Windows**: Fair rate limiting with automatic reset
- **Configurable**: Different limits for different endpoints

### 3. Origin Validation
- **CORS Protection**: Only approved origins can access APIs
- **Same-Origin Support**: Allows requests without origin header
- **Production Ready**: Easy to configure for production domains

### 4. Input Validation
- **URL Length Limits**: Prevents extremely long URLs
- **Type Checking**: Ensures parameters are correct types
- **Format Validation**: Validates URL structure

## Configuration

### Adding New Domains

1. Edit `src/lib/security/domains.ts`:
```typescript
export const ALLOWED_DOMAINS = [
  'fluidtokens.com',
  'aquarium-qa.fluidtokens.com',
  'minswap-multisig-dev.fluidtokens.com',
  'newdomain.com', // Add your domain here
];

export const ALLOWED_HOSTNAMES = [
  'fluidtokens.com',
  'aquarium-qa.fluidtokens.com',
  'minswap-multisig-dev.fluidtokens.com',
  'newdomain.com', // Add your hostname here (must match ALLOWED_DOMAINS)
];
```

**Important:** Always update both arrays when adding new domains to maintain consistency.

### Updating Allowed Origins

1. Set the `CORS_ORIGINS` environment variable:
```bash
# For development (allow all)
CORS_ORIGINS="*"

# For production (specific origins)
CORS_ORIGINS="https://yourdomain.com,https://app.yourdomain.com"

# For subdomain support
CORS_ORIGINS="https://*.yourdomain.com"
```

2. The security module automatically uses the same configuration as your CORS middleware.

### Adjusting Rate Limits

1. Modify the rate limit parameters in your API endpoints:
```typescript
// For OG API (10 requests/minute)
checkRateLimit(clientIP, 10, 60 * 1000)

// For Proxy API (20 requests/minute) 
checkRateLimit(clientIP, 20, 60 * 1000)
```

## Production Considerations

### 1. Redis for Rate Limiting
For multi-instance deployments, replace the in-memory Map with Redis:

```typescript
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

// Update checkRateLimit to use Redis
```

### 2. Environment Variables
The security module automatically uses the existing `CORS_ORIGINS` environment variable:

```bash
# Development
CORS_ORIGINS="*"

# Production
CORS_ORIGINS="https://yourdomain.com,https://app.yourdomain.com"
```

### 3. Monitoring
Add request logging for security monitoring:

```typescript
console.log(`API access: ${clientIP} - ${req.method} ${req.url}`);
```

### 4. API Keys (Optional)
For additional security, add API key authentication:

```typescript
const apiKey = req.headers['x-api-key'];
if (apiKey !== process.env.API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing url parameter | Required parameter not provided |
| 400 | Invalid url parameter | Parameter format is invalid |
| 400 | Domain not allowed | URL domain not in allow-list |
| 403 | Forbidden origin | Request origin not allowed |
| 405 | Method not allowed | HTTP method not supported |
| 429 | Too many requests | Rate limit exceeded |
| 500 | Unable to fetch OpenGraph data | Server error during fetch |
| 502 | Failed to fetch target | Target server error |

## Testing

### Manual Testing
```bash
# Test OG API
curl "http://localhost:3000/api/local/og?url=https://fluidtokens.com/"

# Test Proxy API  
curl "http://localhost:3000/api/local/proxy?src=https://fluidtokens.com/favicon.ico"
```

### Security Testing
```bash
# Test rate limiting
for i in {1..15}; do curl "http://localhost:3000/api/local/og?url=https://fluidtokens.com/"; done

# Test domain blocking
curl "http://localhost:3000/api/local/og?url=https://malicious-site.com/"

# Test origin blocking
curl -H "Origin: https://evil-site.com" "http://localhost:3000/api/local/og?url=https://fluidtokens.com/"
```

## Maintenance

### Regular Tasks
1. **Review Allowed Domains**: Periodically audit the domain allow-list
2. **Monitor Rate Limits**: Adjust limits based on usage patterns
3. **Update Origins**: Keep production origins up to date
4. **Security Logs**: Monitor for suspicious activity

### Adding New APIs
1. Import security utilities
2. Apply validation checks
3. Configure appropriate rate limits
4. Test security measures
5. Update documentation

This security module provides a robust foundation for protecting your API endpoints while maintaining flexibility and ease of use.
