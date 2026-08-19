// Generates the branded 1200×630 social cards under public/ (see OG_CARDS).
//
// Run with:  node scripts/generate-og-image.mjs
//
// Why a script and not a runtime/edge route: the cards are pure functions of the
// copy below, so rasterising them once and committing the PNGs keeps social
// previews free of a runtime dependency, an image budget and a cold start —
// while staying reproducible and reviewable in the diff.
//
// Every marketing route gets its OWN card. A shared card means a /governance
// link and a /roadmap link are indistinguishable in a feed; the eyebrow, the
// headline and the accent tint make each share say what it actually links to.
//
// We rasterise hand-written SVG with `sharp` (already a dependency via
// next/image) and composite the white Mesh logo on top. Text is rendered by
// librsvg using system Helvetica/Arial, so regenerate on a machine that has
// them and commit the result — CI does not rebuild these.
//
// Keep in sync with `routeSeo[...].image` in src/lib/seo.ts. The `og cards`
// test asserts every referenced card actually exists on disk.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const W = 1200;
const H = 630;

/** Left margin; the headline block is inset further by the accent bar. */
const MARGIN = 76;
const TEXT_X = 112;
const CONTENT_W = W - TEXT_X - MARGIN;

/**
 * The cards. `headline` and `subhead` are arrays because SVG has no line
 * wrapping — authoring the breaks explicitly makes the layout exact instead of
 * dependent on a width estimate.
 */
const OG_CARDS = [
  {
    // The site-wide default, and the home page. Path kept as /og-image.png so
    // links shared before per-route cards existed still resolve.
    file: "public/og-image.png",
    accent: "#c9c9d6",
    eyebrow: "Multi-signature wallet",
    headline: ["Cardano treasuries,", "secured by multisig."],
    subhead: ["Free, open-source, Cardano-native multisig for teams & DAOs."],
    chips: ["Treasury", "Governance", "Collaboration"],
  },
  {
    file: "public/og/features.png",
    accent: "#5fbdd0",
    eyebrow: "Features",
    headline: ["Everything a Cardano", "team treasury needs."],
    subhead: ["M-of-N approvals, signer invites, governance voting, staking."],
    chips: ["Approvals", "Invites", "History"],
  },
  {
    file: "public/og/governance.png",
    accent: "#8b7ff0",
    eyebrow: "Governance",
    headline: ["Vote on Cardano", "governance as a team."],
    subhead: ["Browse proposals and cast votes with M-of-N approval."],
    chips: ["Proposals", "DRep", "On-chain votes"],
  },
  {
    file: "public/og/drep.png",
    accent: "#7fb2f0",
    eyebrow: "DRep explorer",
    headline: ["Find the DRep that", "votes like you do."],
    subhead: ["Voting records, delegated stake and metadata for every DRep."],
    chips: ["Voting records", "Delegated stake"],
  },
  {
    file: "public/og/roadmap.png",
    accent: "#e0a45e",
    eyebrow: "Roadmap",
    headline: ["Twelve months of", "Mesh Multisig."],
    subhead: ["What shipped, what is in progress, and what comes next."],
    chips: ["April 2026", "March 2027"],
  },
  {
    file: "public/og/roadmap-graph.png",
    accent: "#e0a45e",
    eyebrow: "Feature graph",
    headline: ["Every feature, and", "what it connects to."],
    subhead: ["An interactive graph of delivered, planned and blocked work."],
    chips: ["Delivered", "Planned", "Blocked"],
  },
  {
    file: "public/og/blog.png",
    accent: "#6fc79b",
    eyebrow: "Blog",
    headline: ["Notes on multisig,", "governance and agents."],
    subhead: ["Guides and updates from the team behind Mesh Multisig."],
    chips: ["Guides", "Release notes"],
  },
  {
    file: "public/og/api-docs.png",
    accent: "#5fbdd0",
    eyebrow: "API & bots",
    headline: ["Drive your treasury", "from code."],
    subhead: ["OpenAPI-documented REST endpoints for bots and agents."],
    chips: ["REST", "OpenAPI", "Bot auth"],
  },
  {
    file: "public/og/dapps.png",
    accent: "#d97fae",
    eyebrow: "DApps",
    headline: ["Use any Cardano dApp", "in multisig mode."],
    subhead: ["Connect Mesh Multisig to the dApps your team already uses."],
    chips: ["CIP-30", "Multisig mode"],
  },
  {
    file: "public/og/import-wallet.png",
    accent: "#c9c9d6",
    eyebrow: "Import wallet",
    headline: ["Bring your multisig", "wallet with you."],
    subhead: ["Import from another instance, Summon, raw CBOR or a backup."],
    chips: ["Instance", "Summon", "CBOR", "JSON"],
  },
];

const FONT = "Helvetica, Arial, sans-serif";

/** XML-escape a copy string before it goes into the SVG. */
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Rough advance-width estimate for Helvetica, calibrated against the rendered
 * card. Only used to warn about copy that would overflow — never to lay out.
 */
function estimateWidth(
  text,
  fontSize,
  { bold = false, uppercase = false, letterSpacing = 0 } = {},
) {
  // Calibrated against rendered output: uppercase Helvetica is materially wider
  // per glyph than mixed case, and under-measuring it overflows the pill.
  const factor = uppercase ? 0.635 : bold ? 0.51 : 0.47;
  return text.length * (fontSize * factor + letterSpacing);
}

function warnIfWide(label, text, width, limit) {
  if (width > limit) {
    console.warn(
      `  ! "${text}" is ~${Math.round(width)}px wide, over the ${limit}px ${label} limit — shorten it.`,
    );
  }
}

function buildSvg(card) {
  const { accent, eyebrow, headline, subhead, chips } = card;

  // --- eyebrow pill, right-aligned in the header row -----------------------
  const eyebrowText = eyebrow.toUpperCase();
  const eyebrowSize = 19;
  const eyebrowLs = 2.6;
  const eyebrowTextW = estimateWidth(eyebrowText, eyebrowSize, {
    bold: true,
    uppercase: true,
    letterSpacing: eyebrowLs,
  });
  // 44px lead-in covers the dot, 26px trails the text.
  const pillW = Math.round(eyebrowTextW + 44 + 26);
  const pillH = 44;
  const pillX = W - MARGIN - pillW;
  const pillY = 62;

  // --- headline block ------------------------------------------------------
  const headSize = 72;
  const headLead = 84;
  const firstBaseline = headline.length > 1 ? 300 : 342;
  const lastBaseline = firstBaseline + (headline.length - 1) * headLead;

  const barTop = firstBaseline - 60;
  const barBottom = lastBaseline + 18;

  const subSize = 27;
  const subLead = 38;
  const subFirst = lastBaseline + 66;

  headline.forEach((line) =>
    warnIfWide(
      "headline",
      line,
      estimateWidth(line, headSize, { bold: true, letterSpacing: -1.8 }),
      CONTENT_W,
    ),
  );
  subhead.forEach((line) =>
    warnIfWide("subhead", line, estimateWidth(line, subSize), CONTENT_W),
  );

  const headlineSvg = headline
    .map(
      (line, i) =>
        `<text x="${TEXT_X}" y="${firstBaseline + i * headLead}" font-family="${FONT}" font-size="${headSize}" font-weight="700" fill="#ffffff" letter-spacing="-1.8">${esc(line)}</text>`,
    )
    .join("\n  ");

  const subheadSvg = subhead
    .map(
      (line, i) =>
        `<text x="${TEXT_X}" y="${subFirst + i * subLead}" font-family="${FONT}" font-size="${subSize}" fill="#a2a2ad">${esc(line)}</text>`,
    )
    .join("\n  ");

  return `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d0d10"/>
      <stop offset="100%" stop-color="#030304"/>
    </linearGradient>
    <!-- Accent-tinted key light, top-left, behind the wordmark. -->
    <radialGradient id="key" cx="16%" cy="10%" r="62%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="${accent}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <!-- Cooler fill light, bottom-right, to keep the card from going flat. -->
    <radialGradient id="fill" cx="88%" cy="96%" r="55%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#key)"/>
  <rect width="${W}" height="${H}" fill="url(#fill)"/>

  <!-- Mesh mark echoed as a large, near-invisible motif. Reads as texture at
       full size and disappears entirely at feed-thumbnail size. -->
  <g stroke="${accent}" stroke-opacity="0.045" stroke-width="2.5" fill="none">
    <rect x="855" y="285" width="186" height="186" transform="rotate(45 948 378)"/>
    <rect x="947" y="285" width="186" height="186" transform="rotate(45 1040 378)"/>
    <rect x="901" y="219" width="186" height="186" transform="rotate(45 994 312)"/>
  </g>

  <!-- 1px inner frame; keeps the card from bleeding into light-mode timelines. -->
  <rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1.5"/>

  <!-- wordmark (logo composited separately, see below) -->
  <text x="${MARGIN + 106}" y="115" font-family="${FONT}" font-size="37" font-weight="700" fill="#ffffff" letter-spacing="-0.4">Mesh Multisig</text>

  <!-- section eyebrow -->
  <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${accent}" fill-opacity="0.10" stroke="${accent}" stroke-opacity="0.34" stroke-width="1.5"/>
  <circle cx="${pillX + 26}" cy="${pillY + pillH / 2}" r="4.5" fill="${accent}" fill-opacity="0.95"/>
  <text x="${pillX + 44}" y="${pillY + pillH / 2 + 7}" font-family="${FONT}" font-size="${eyebrowSize}" font-weight="600" fill="${accent}" letter-spacing="${eyebrowLs}">${esc(eyebrowText)}</text>

  <!-- accent rule anchoring the headline block -->
  <rect x="${MARGIN}" y="${barTop}" width="5" height="${barBottom - barTop}" rx="2.5" fill="${accent}" fill-opacity="0.85"/>

  ${headlineSvg}

  ${subheadSvg}

  <!-- footer -->
  <rect x="${MARGIN}" y="534" width="${W - MARGIN * 2}" height="1.5" fill="#ffffff" fill-opacity="0.08"/>
  <text x="${MARGIN}" y="581" font-family="${FONT}" font-size="25" font-weight="600" fill="#ededf2">multisig.meshjs.dev</text>
  <text x="${W - MARGIN}" y="581" text-anchor="end" font-family="${FONT}" font-size="22" fill="#8a8a93">${esc(chips.join("  ·  "))}</text>
</svg>
`;
}

const logo = await sharp(
  join(root, "public/logo-mesh/white/logo-mesh-white-512x512.png"),
)
  .resize(84, 84, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await mkdir(join(root, "public/og"), { recursive: true });

for (const card of OG_CARDS) {
  console.log(`Rendering ${card.file}`);
  await sharp(Buffer.from(buildSvg(card)))
    .composite([{ input: logo, top: 54, left: MARGIN }])
    .png({ compressionLevel: 9 })
    .toFile(join(root, card.file));
}

console.log(`Wrote ${OG_CARDS.length} social cards.`);
