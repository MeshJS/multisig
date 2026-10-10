/**
 * The sign-off proof as a PDF a person can read.
 *
 * PRD-001 asks for the audit proof in two forms. The JSON package is the
 * machine-verifiable one and stays authoritative: it is what `verifyProof`
 * re-runs the maths over. This is its human-readable twin — the artifact that
 * gets attached to a board pack, filed with a contract, or handed to a
 * counterparty's lawyer, who is not going to open a JSON file.
 *
 * It is deliberately self-contained: every signature, its signing key and the
 * exact canonical payload that was signed are printed, so the four verification
 * steps can be carried out from the paper alone if the JSON is ever lost. The
 * page says plainly which of the two is authoritative, so nobody mistakes a
 * pretty PDF for the thing that actually verifies.
 *
 * Written by hand rather than with a PDF library. The content is text in three
 * base-14 fonts; a library would add a few hundred kilobytes to the bundle for
 * a single button and still could not render scripts outside WinAnsi without an
 * embedded font. The output is deterministic — the same package always produces
 * the same bytes, which is what lets a test assert on them and lets two people
 * compare the PDFs they each exported.
 */

import type { ProofPackage, ProofVerification } from "./proof";

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FOOTER_BASELINE = 40;
/** Text stops here; anything lower would collide with the footer. */
const CONTENT_FLOOR = 64;

type FontId = "F1" | "F2" | "F3";
const REGULAR: FontId = "F1";
const BOLD: FontId = "F2";
const MONO: FontId = "F3";

/**
 * Helvetica advance widths for ASCII, in 1/1000 em. Only used to decide where
 * to wrap, so the Latin-1 fallback below being approximate costs nothing worse
 * than a line that breaks a word early.
 */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const LATIN1_FALLBACK_WIDTH = 556;
const COURIER_WIDTH = 600;
/** Helvetica-Bold runs wider than Helvetica; wrap conservatively rather than carry a second table. */
const BOLD_WIDTH_FACTOR = 1.08;

/** Unicode this deployment is likely to meet, folded to something WinAnsi has. */
const TRANSLITERATIONS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": ",",
  "“": '"',
  "”": '"',
  "„": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
  "•": "-",
  "€": "EUR",
  "→": "->",
  "·": "-",
};

/**
 * Fold text into the WinAnsi range the base-14 fonts can encode.
 *
 * Latin-1 accented characters survive, which covers the languages this wallet
 * is actually used in. Anything further out — CJK, Cyrillic, emoji in a
 * document title — becomes "?" rather than corrupting the stream. The hashes,
 * addresses and signatures that carry the evidence are ASCII by construction,
 * so nothing that matters to verification can be lost this way.
 */
export function toWinAnsi(value: string): string {
  let out = "";
  for (const char of value) {
    const mapped = TRANSLITERATIONS[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) {
      out += " ";
    } else if (code >= 32 && code <= 126) {
      out += char;
    } else if (code >= 160 && code <= 255) {
      out += char;
    } else {
      out += "?";
    }
  }
  return out;
}

function charWidth(code: number, font: FontId): number {
  if (font === MONO) return COURIER_WIDTH;
  const base =
    code >= 32 && code <= 126
      ? (HELVETICA_WIDTHS[code - 32] ?? LATIN1_FALLBACK_WIDTH)
      : LATIN1_FALLBACK_WIDTH;
  return font === BOLD ? base * BOLD_WIDTH_FACTOR : base;
}

function textWidth(value: string, font: FontId, size: number): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    total += charWidth(value.charCodeAt(i), font);
  }
  return (total * size) / 1000;
}

/**
 * Greedy wrap at spaces, falling back to breaking mid-token.
 *
 * The mid-token break is not a nicety: a COSE_Sign1 signature is one 600-odd
 * character "word" and would otherwise run off the page.
 */
function wrapText(
  value: string,
  font: FontId,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = "";

  const pushChunked = (token: string) => {
    let rest = token;
    while (rest.length > 0) {
      let take = rest.length;
      while (take > 1 && textWidth(rest.slice(0, take), font, size) > maxWidth) {
        take -= 1;
      }
      lines.push(rest.slice(0, take));
      rest = rest.slice(take);
    }
  };

  for (const token of value.split(" ")) {
    if (token === "") continue;
    const candidate = line === "" ? token : `${line} ${token}`;
    if (textWidth(candidate, font, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== "") {
      lines.push(line);
      line = "";
    }
    if (textWidth(token, font, size) <= maxWidth) {
      line = token;
    } else {
      pushChunked(token);
    }
  }
  if (line !== "") lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** PDF string literals escape the delimiters and the escape character itself. */
function escapeText(value: string): string {
  return value.replace(/([\\()])/g, "\\$1");
}

/** Trim float noise; PDF has no use for 14 decimal places. */
function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

interface TextOptions {
  font?: FontId;
  size?: number;
  indent?: number;
  /** Extra space above the line, applied before the page-break check. */
  spaceBefore?: number;
  /** 0 is black, 1 is white. */
  gray?: number;
}

class PdfWriter {
  private readonly pages: string[][] = [];
  private ops: string[] = [];
  private y = 0;

  constructor() {
    this.startPage();
  }

  private startPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Break the page when the next line would not fit above the footer. */
  private reserve(height: number): void {
    if (this.y - height < CONTENT_FLOOR) this.startPage();
  }

  text(value: string, options: TextOptions = {}): void {
    const font = options.font ?? REGULAR;
    const size = options.size ?? 9.5;
    const indent = options.indent ?? 0;
    const leading = size * 1.42;
    const maxWidth = PAGE_WIDTH - MARGIN * 2 - indent;

    if (options.spaceBefore) {
      this.reserve(options.spaceBefore + leading);
      this.y -= options.spaceBefore;
    }

    for (const line of wrapText(toWinAnsi(value), font, size, maxWidth)) {
      this.reserve(leading);
      this.y -= leading;
      const gray = options.gray;
      if (gray !== undefined) this.ops.push(`${num(gray)} g`);
      this.ops.push(
        `BT /${font} ${num(size)} Tf 1 0 0 1 ${num(MARGIN + indent)} ${num(this.y)} Tm (${escapeText(line)}) Tj ET`,
      );
      if (gray !== undefined) this.ops.push("0 g");
    }
  }

  /** A section heading with a hairline under it. */
  heading(value: string): void {
    // Reserve the whole block first so a heading never lands alone at the foot
    // of a page with its rule orphaned onto the next one.
    this.reserve(16 + 8.5 * 1.42 + 10);
    this.text(value.toUpperCase(), {
      font: BOLD,
      size: 8.5,
      spaceBefore: 16,
      gray: 0.35,
    });
    this.reserve(8);
    this.y -= 4;
    this.ops.push(
      `0.8 g ${num(MARGIN)} ${num(this.y)} ${num(PAGE_WIDTH - MARGIN * 2)} 0.5 re f 0 g`,
    );
    this.y -= 6;
  }

  /** A label and its value on one wrapped run — the workhorse of the layout. */
  field(label: string, value: string | null | undefined, mono = false): void {
    if (value === null || value === undefined || value === "") return;
    this.text(label, { font: BOLD, size: 8, gray: 0.4, spaceBefore: 5 });
    this.text(value, { font: mono ? MONO : REGULAR, size: mono ? 8 : 9.5 });
  }

  gap(height: number): void {
    this.y -= height;
  }

  /**
   * Stamp the footer once the page count is known, and hand back the content
   * streams. Page numbers are why this cannot be written during layout.
   */
  finish(footerLeft: string): string[] {
    const total = this.pages.length;
    return this.pages.map((ops, index) => {
      const left = toWinAnsi(footerLeft);
      const right = `Page ${index + 1} of ${total}`;
      const rightWidth = textWidth(right, REGULAR, 7.5);
      return [
        ...ops,
        "0.45 g",
        `BT /${REGULAR} 7.5 Tf 1 0 0 1 ${num(MARGIN)} ${FOOTER_BASELINE} Tm (${escapeText(left)}) Tj ET`,
        `BT /${REGULAR} 7.5 Tf 1 0 0 1 ${num(PAGE_WIDTH - MARGIN - rightWidth)} ${FOOTER_BASELINE} Tm (${escapeText(right)}) Tj ET`,
        "0 g",
      ].join("\n");
    });
  }
}

/** ISO-8601 to the PDF date syntax, which predates ISO-8601 in this codebase's world. */
function pdfDate(iso: string): string {
  const parsed = new Date(iso);
  const stamp = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `D:${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}` +
    `${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}${pad(stamp.getUTCSeconds())}Z`
  );
}

/**
 * Latin-1 out: every byte is one character, which keeps the xref offsets honest.
 *
 * Typed as `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array` so the
 * result is assignable to `BlobPart` — TypeScript 5.7 made the view generic
 * over its buffer, and the plain form admits a `SharedArrayBuffer` that `Blob`
 * will not take.
 */
function latin1Bytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** Assemble numbered objects into a file, with a cross-reference table. */
function serialize(
  objects: string[],
  rootIndex: number,
  infoIndex: number,
): Uint8Array<ArrayBuffer> {
  // The binary comment tells tools transferring this file that it is not text.
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${rootIndex} 0 R /Info ${infoIndex} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return latin1Bytes(out);
}

function shortAddress(address: string): string {
  return address.length > 24
    ? `${address.slice(0, 12)}...${address.slice(-8)}`
    : address;
}

function formatBytes(size: number | null | undefined): string | null {
  if (size === null || size === undefined) return null;
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ProofPdfOptions {
  /**
   * A verification this deployment just performed, printed as a checked-by
   * line. Omitted when the wallet exports the proof, because the exporter
   * vouching for its own export proves nothing.
   */
  verification?: ProofVerification | null;
  /** Where a reader can check the JSON themselves, e.g. https://…/verify. */
  verifyUrl?: string;
}

/**
 * Render a proof package as a PDF.
 *
 * Pure: no DOM, no filesystem, no clock — the bytes are a function of the
 * package, so the browser and a server-side caller produce the same file.
 */
export function buildProofPdf(
  pkg: ProofPackage,
  options: ProofPdfOptions = {},
): Uint8Array<ArrayBuffer> {
  const w = new PdfWriter();
  const approvals = pkg.reviews.filter((r) => r.action === "approve").length;

  w.text(pkg.document.title, { font: BOLD, size: 17 });
  w.text(
    `Document Sign-Off proof - version ${pkg.version.versionNumber} - ${pkg.version.status}`,
    { size: 10, gray: 0.35 },
  );
  w.text(`Exported ${pkg.exportedAt}`, { size: 8.5, gray: 0.45 });

  w.text(
    "This PDF is a readable summary. The JSON proof package it was made from is the " +
      "authoritative artifact: it is what a verifier checks. Both carry the same hash, " +
      "signer set and signatures.",
    { size: 8.5, gray: 0.4, spaceBefore: 10 },
  );

  const { verification } = options;
  if (verification) {
    w.text(
      verification.valid
        ? `Checked: ${verification.approvals} of ${verification.requiredSigners} required signatures verified.`
        : `Checked: this proof did NOT verify. ${verification.errors.join(" ")}`,
      { font: BOLD, size: 9.5, spaceBefore: 8 },
    );
    if (verification.contentHashMatches !== undefined) {
      w.text(
        verification.contentHashMatches
          ? "The supplied file hashes to the approved content hash."
          : "The supplied file does NOT hash to the approved content hash.",
        { size: 9, gray: 0.3 },
      );
    }
  }

  w.heading("Document");
  w.field("Title", pkg.document.title);
  w.field("Description", pkg.document.description);
  w.field("Type", pkg.document.documentType);
  w.field("Document ID", pkg.document.id, true);
  w.field("Wallet ID", pkg.document.walletId, true);
  w.field("Created by", pkg.document.createdBy, true);
  w.field("Created at", pkg.document.createdAt);

  w.heading("Version");
  w.field("Version", `${pkg.version.versionNumber}`);
  w.field("Status", pkg.version.status);
  w.field(
    `Content hash (${pkg.version.hashAlgorithm})`,
    pkg.version.contentHash,
    true,
  );
  w.field("File", pkg.version.fileName);
  w.field("Size", formatBytes(pkg.version.fileSize));
  w.field("Media type", pkg.version.mimeType);
  w.field("Review started", pkg.version.reviewStartedAt);
  w.field("Decided", pkg.version.decidedAt);

  w.heading("Approval policy, frozen when the review opened");
  w.field(
    "Threshold",
    `${pkg.policy.requiredSigners} of ${pkg.policy.signersAddresses.length} signers`,
  );
  w.field("Wallet policy hash", pkg.policy.walletPolicyHash, true);
  w.field("Captured at", pkg.policy.capturedAt);
  w.text("Signers", { font: BOLD, size: 8, gray: 0.4, spaceBefore: 5 });
  pkg.policy.signersAddresses.forEach((address, index) => {
    const description = pkg.policy.signersDescriptions[index];
    if (description) {
      w.text(description, { size: 9, spaceBefore: 3 });
    }
    w.text(address, { font: MONO, size: 7.5, indent: description ? 10 : 0 });
  });

  w.heading(`Signatures (${approvals} approvals of ${pkg.policy.requiredSigners} required)`);
  if (pkg.reviews.length === 0) {
    w.text("No signer has acted on this version.", { size: 9.5, gray: 0.4 });
  }
  pkg.reviews.forEach((review, index) => {
    const who = review.signerDescription ?? shortAddress(review.signerAddress);
    w.text(
      `${index + 1}. ${review.action === "approve" ? "Approved" : "Rejected"} by ${who} - ${review.signedAt}`,
      { font: BOLD, size: 10, spaceBefore: 12 },
    );
    if (review.partyRole) {
      w.field("Signing as", review.partyRole);
    }
    w.field("Signer", review.signerAddress, true);
    w.field("Comment", review.comment);
    w.field("Signed payload", review.payload, true);
    w.field("Signature (COSE_Sign1)", review.signature, true);
    w.field("Key (COSE_Key)", review.signatureKey, true);
  });

  if (pkg.events.length > 0) {
    w.heading("Audit trail");
    for (const event of pkg.events) {
      w.text(
        `${event.createdAt}  ${event.type}${event.actorAddress ? `  ${shortAddress(event.actorAddress)}` : ""}`,
        { font: MONO, size: 8, spaceBefore: 2 },
      );
    }
  }

  w.heading("How to verify");
  if (options.verifyUrl) {
    w.text(
      `Paste the JSON proof package at ${options.verifyUrl} — or, better, do it yourself:`,
      { size: 9.5 },
    );
  }
  for (const instruction of pkg.verification.instructions) {
    w.text(instruction, { size: 9, spaceBefore: 4, indent: 8 });
  }
  w.field("Signing domain", pkg.verification.domain, true);

  const footer = `${pkg.format} - ${pkg.document.id} v${pkg.version.versionNumber}`;
  const contents = w.finish(footer);

  // Object numbering: catalog, pages, three fonts, info, then a page object and
  // a content stream for each page.
  const catalogIndex = 1;
  const pagesIndex = 2;
  const fontIndexes = { F1: 3, F2: 4, F3: 5 };
  const infoIndex = 6;
  const firstPageIndex = 7;

  const pageIndexes = contents.map((_, i) => firstPageIndex + i * 2);
  const objects: string[] = [
    `<< /Type /Catalog /Pages ${pagesIndex} 0 R >>`,
    `<< /Type /Pages /Kids [${pageIndexes.map((i) => `${i} 0 R`).join(" ")}] /Count ${contents.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
    `<< /Title (${escapeText(toWinAnsi(`${pkg.document.title} - sign-off proof v${pkg.version.versionNumber}`))}) ` +
      `/Producer (Mesh Multisig) /Creator (${escapeText(pkg.format)}) /CreationDate (${pdfDate(pkg.exportedAt)}) >>`,
  ];

  for (const content of contents) {
    objects.push(
      `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
        `/Resources << /Font << /F1 ${fontIndexes.F1} 0 R /F2 ${fontIndexes.F2} 0 R /F3 ${fontIndexes.F3} 0 R >> >> ` +
        `/Contents ${objects.length + 2} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  return serialize(objects, catalogIndex, infoIndex);
}

/** `signoff-proof-<document>-v<n>.pdf`, matching the JSON export's naming. */
export function proofPdfFileName(pkg: ProofPackage): string {
  return `signoff-proof-${pkg.document.id}-v${pkg.version.versionNumber}.pdf`;
}
