// Allow-list of trusted domains for dApp OpenGraph fetching and image proxying
export const ALLOWED_DOMAINS = [
  'fluidtokens.com',
  'aquarium-qa.fluidtokens.com',
  'minswap-multisig-dev.fluidtokens.com',
  // Add more trusted domains as needed
];

export function isAllowedDomain(url: string): boolean {
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
