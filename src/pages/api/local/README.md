# Local API Endpoints

This directory contains internal API endpoints for the multisig application. These endpoints are designed for client-side use only and include comprehensive security measures.

## Endpoints

### OpenGraph API (`/api/local/og`)

Fetches OpenGraph and Twitter Card metadata from trusted domains to display rich previews for dApp cards.

**Endpoint:** `GET /api/local/og?url=<encoded-url>`

**Parameters:**
- `url` (required): The URL to fetch metadata from (must be URL-encoded)

**Response:**
```json
{
  "title": "Page Title",
  "description": "Page Description", 
  "image": "/api/local/proxy?src=...",
  "favicon": "/api/local/proxy?src=..."
}
```

**Example:**
```bash
curl "http://localhost:3000/api/local/og?url=https%3A%2F%2Ffluidtokens.com%2F"
```

**Security Features:**
- ✅ Rate limiting: 100 requests/minute (dev), 10 requests/minute (prod)
- ✅ Origin validation using `CORS_ORIGINS` environment variable
- ✅ Domain allow-list (only trusted domains)
- ✅ URL parameter validation
- ✅ SSRF protection

### Image Proxy API (`/api/local/proxy`)

Proxies images from trusted domains to avoid CORS issues and provide consistent image serving.

**Endpoint:** `GET /api/local/proxy?src=<encoded-image-url>`

**Parameters:**
- `src` (required): The image URL to proxy (must be URL-encoded)

**Response:** 
- Content-Type: Image binary data with appropriate headers
- Cache-Control: `public, max-age=3600` (1 hour cache)

**Example:**
```bash
curl "http://localhost:3000/api/local/proxy?src=https%3A%2F%2Ffluidtokens.com%2Ffavicon.ico"
```

**Security Features:**
- ✅ Rate limiting: 200 requests/minute (dev), 20 requests/minute (prod)
- ✅ Origin validation using `CORS_ORIGINS` environment variable
- ✅ Domain allow-list (only trusted domains)
- ✅ URL parameter validation
- ✅ SSRF protection

## Configuration

### Environment Variables

#### Required
- `CORS_ORIGINS`: Comma-separated list of allowed origins
  ```bash
  # Development (allow all)
  CORS_ORIGINS="*"
  
  # Production (specific origins)
  CORS_ORIGINS="https://yourdomain.com,https://app.yourdomain.com"
  ```

#### Optional
- `DISABLE_RATE_LIMIT`: Set to `true` to disable rate limiting in development
  ```bash
  DISABLE_RATE_LIMIT=true
  ```

### Domain Configuration

Edit `src/lib/security/domains.ts` to add new trusted domains:

```typescript
export const ALLOWED_DOMAINS = [
  'fluidtokens.com',
  'aquarium-qa.fluidtokens.com',
  'minswap-multisig-dev.fluidtokens.com',
  'your-new-domain.com', // Add your domain here
];
```

## Usage in Components

### DappCard Component

The dApp cards automatically use these endpoints:

```typescript
// Fetch OpenGraph data
const res = await fetch(`/api/local/og?url=${encodeURIComponent(url)}`);
const data = await res.json();

// Images are automatically proxied
// data.image = "/api/local/proxy?src=..."
// data.favicon = "/api/local/proxy?src=..."
```

### Manual Usage

```typescript
// Fetch metadata for a URL
async function getOgData(url: string) {
  const response = await fetch(`/api/local/og?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch OG data: ${response.status}`);
  }
  return response.json();
}

// Proxy an image
function getProxiedImageUrl(originalUrl: string): string {
  return `/api/local/proxy?src=${encodeURIComponent(originalUrl)}`;
}
```

## Error Handling

### Common Error Responses

| Status | Error | Description | Solution |
|--------|-------|-------------|----------|
| 400 | Missing url parameter | URL parameter not provided | Provide `url` parameter |
| 400 | Invalid url parameter | URL format is invalid | Check URL format and length |
| 400 | Domain not allowed | URL domain not in allow-list | Add domain to `ALLOWED_DOMAINS` |
| 403 | Forbidden origin | Request origin not allowed | Update `CORS_ORIGINS` |
| 405 | Method not allowed | Wrong HTTP method | Use GET requests only |
| 429 | Too many requests | Rate limit exceeded | Wait or increase limits |
| 500 | Unable to fetch OpenGraph data | Server error during fetch | Check target URL availability |
| 502 | Failed to fetch target | Target server error | Check target server status |

### Error Handling Example

```typescript
async function fetchOgWithErrorHandling(url: string) {
  try {
    const response = await fetch(`/api/local/og?url=${encodeURIComponent(url)}`);
    
    if (!response.ok) {
      const error = await response.json();
      console.error('API Error:', error);
      
      switch (response.status) {
        case 400:
          throw new Error('Invalid URL or domain not allowed');
        case 403:
          throw new Error('Origin not allowed');
        case 429:
          throw new Error('Rate limit exceeded');
        default:
          throw new Error(`API error: ${response.status}`);
      }
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch OG data:', error);
    return null;
  }
}
```

## Development vs Production

### Development Mode
- **Higher Rate Limits**: 10x higher limits for development
- **Relaxed CORS**: Can use `CORS_ORIGINS="*"`
- **Debug Logging**: Console logs for troubleshooting
- **Hot Reloading**: Handles React development mode effects

### Production Mode
- **Strict Rate Limits**: Lower limits for security
- **Specific Origins**: Must specify exact allowed origins
- **No Debug Logging**: Clean production logs
- **Optimized Performance**: Cached responses and efficient processing

## Security Considerations

### SSRF Protection
- **Domain Allow-List**: Only approved domains can be accessed
- **Protocol Restriction**: Only HTTP/HTTPS allowed
- **Private IP Blocking**: Prevents access to internal networks

### Rate Limiting
- **Per-IP Limits**: Prevents abuse from individual IPs
- **Sliding Windows**: Fair rate limiting with automatic reset
- **Environment-Aware**: Different limits for dev/prod

### Origin Validation
- **CORS Protection**: Only approved origins can access APIs
- **Same-Origin Support**: Allows requests without origin header
- **Subdomain Support**: Handles `*.yourdomain.com` patterns

## Monitoring

### Request Logging
Add logging to monitor API usage:

```typescript
console.log(`API access: ${clientIP} - ${req.method} ${req.url}`);
```

### Rate Limit Monitoring
Monitor rate limit hits:

```typescript
if (!checkRateLimit(clientIP, maxRequests, windowMs)) {
  console.warn(`Rate limit exceeded for IP: ${clientIP}`);
  return res.status(429).json({ error: 'Too many requests' });
}
```

## Testing

### Manual Testing
```bash
# Test OG API
curl "http://localhost:3000/api/local/og?url=https%3A%2F%2Ffluidtokens.com%2F"

# Test Proxy API
curl "http://localhost:3000/api/local/proxy?src=https%3A%2F%2Ffluidtokens.com%2Ffavicon.ico"
```

### Security Testing
```bash
# Test rate limiting
for i in {1..15}; do 
  curl "http://localhost:3000/api/local/og?url=https%3A%2F%2Ffluidtokens.com%2F"
done

# Test domain blocking
curl "http://localhost:3000/api/local/og?url=https%3A%2F%2Fmalicious-site.com%2F"

# Test origin blocking
curl -H "Origin: https://evil-site.com" \
  "http://localhost:3000/api/local/og?url=https%3A%2F%2Ffluidtokens.com%2F"
```

## Troubleshooting

### Common Issues

1. **429 Too Many Requests**
   - **Cause**: Rate limit exceeded
   - **Solution**: Wait or set `DISABLE_RATE_LIMIT=true` in development

2. **403 Forbidden Origin**
   - **Cause**: Origin not in `CORS_ORIGINS`
   - **Solution**: Update `CORS_ORIGINS` environment variable

3. **400 Domain not allowed**
   - **Cause**: URL domain not in allow-list
   - **Solution**: Add domain to `ALLOWED_DOMAINS` in `domains.ts`

4. **502 Failed to fetch target**
   - **Cause**: Target server is down or unreachable
   - **Solution**: Check target URL availability

### Debug Mode
Enable debug logging by setting:
```bash
NODE_ENV=development
```

This will show detailed CORS and request information in the console.

## Maintenance

### Regular Tasks
1. **Review Allowed Domains**: Periodically audit the domain allow-list
2. **Monitor Rate Limits**: Adjust limits based on usage patterns
3. **Update Origins**: Keep production origins up to date
4. **Security Logs**: Monitor for suspicious activity

### Adding New dApp Cards
1. Add the dApp URL to your component
2. Add the domain to `ALLOWED_DOMAINS` if not already present
3. Test the OG data fetching
4. Verify images load correctly

This API provides a secure, efficient way to fetch and display rich metadata for dApp cards while protecting against common web vulnerabilities.
