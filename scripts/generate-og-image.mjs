// Generates the static social card at public/og-image.png (1200×630).
//
// Run with:  node scripts/generate-og-image.mjs
//
// We rasterise a hand-written SVG with `sharp` (already a dependency via
// next/image) and composite the white Mesh logo on top. Keeping this as a
// committed script means the card is reproducible and tweakable without any
// design tooling or runtime/edge dependency.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const W = 1200;
const H = 630;

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0c0c0e"/>
      <stop offset="100%" stop-color="#040405"/>
    </linearGradient>
    <radialGradient id="glow" cx="22%" cy="18%" r="60%">
      <stop offset="0%" stop-color="#3a3a44" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#1a1a1f" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <font-face font-family="sans">
      <font-face-src><font-face-name name="Helvetica"/></font-face-src>
    </font-face>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- frame -->
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="0" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>

  <!-- wordmark (logo composited separately at x=80,y=66) -->
  <text x="196" y="123" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#ffffff" letter-spacing="-0.5">Mesh Multisig</text>

  <!-- headline -->
  <text x="80" y="320" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#ffffff" letter-spacing="-2">Cardano treasuries,</text>
  <text x="80" y="408" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#ffffff" letter-spacing="-2">secured by multisig.</text>

  <!-- subhead -->
  <text x="82" y="470" font-family="Helvetica, Arial, sans-serif" font-size="29" font-weight="400" fill="#a7a7b0">Free, open-source, Cardano-native multi-signature wallet for teams &amp; DAOs.</text>

  <!-- bottom row -->
  <rect x="80" y="540" width="${W - 160}" height="1.5" fill="#ffffff" fill-opacity="0.08"/>
  <text x="80" y="585" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#ededf2">multisig.meshjs.dev</text>
  <text x="${W - 80}" y="585" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="400" fill="#8a8a93">Treasury · Governance · Collaboration</text>
</svg>
`;

const logo = await sharp(
  join(root, "public/logo-mesh/white/logo-mesh-white-512x512.png"),
)
  .resize(96, 96, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await sharp(Buffer.from(svg))
  .composite([{ input: logo, top: 50, left: 80 }])
  .png()
  .toFile(join(root, "public/og-image.png"));

console.log("Wrote public/og-image.png");
