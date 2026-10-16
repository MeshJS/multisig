/**
 * Document Sign-Off v1 (Revision Provenance) — version diff.
 *
 * Two layers, because the platform does not always hold the bytes:
 *
 *  - **Metadata diff** works for every version, including `hashOnly` ones whose
 *    content never left the signer's machine. It answers "did the content
 *    change, and what else changed with it" from the rows alone.
 *  - **Content diff** is a line diff, and only runs when both versions carry
 *    their bytes inline and those bytes decode as text. For anything else the
 *    result says why there is no content diff instead of guessing.
 *
 * Dependency-free on purpose (node Buffer only), like payload.ts and proof.ts,
 * so it runs the same in the router, a test, or an offline tool.
 */

/** Fields compared between two versions, in display order. */
export const DIFFED_VERSION_FIELDS = [
  "contentHash",
  "fileName",
  "mimeType",
  "fileSize",
  "storageMode",
  "contentRef",
  "reviewInstructions",
] as const;

export type DiffedVersionField = (typeof DIFFED_VERSION_FIELDS)[number];

export interface DiffableVersion {
  id: string;
  versionNumber: number;
  contentHash: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  storageMode: "hashOnly" | "inline" | "external";
  contentRef: string | null;
  contentInline: string | null;
  reviewInstructions: string | null;
}

export interface FieldChange {
  field: DiffedVersionField;
  from: string | number | null;
  to: string | number | null;
}

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  /** 1-based line number in the older version; null for added lines. */
  oldLine: number | null;
  /** 1-based line number in the newer version; null for removed lines. */
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type ContentDiff =
  | {
      kind: "identical";
      reason: string;
    }
  | {
      kind: "text";
      added: number;
      removed: number;
      hunks: DiffHunk[];
    }
  | {
      kind: "unavailable";
      reason: string;
    };

export interface VersionDiff {
  from: { id: string; versionNumber: number; contentHash: string };
  to: { id: string; versionNumber: number; contentHash: string };
  contentChanged: boolean;
  fieldChanges: FieldChange[];
  content: ContentDiff;
}

/**
 * Upper bound on the comparison grid after the common prefix and suffix are
 * trimmed. The LCS table is old×new cells; at 4M cells it stays well under
 * 100ms and 16MB. Past it the result says the diff is too large rather than
 * stalling a request — two hash-bound versions are still distinguishable by
 * their hashes, which the metadata diff always reports.
 */
export const MAX_DIFF_CELLS = 4_000_000;

/** Lines of unchanged context kept around each change. */
export const DIFF_CONTEXT = 3;

/**
 * Decode inline bytes as text, or explain why not.
 *
 * Text is judged by content, not by the declared MIME type: the type is
 * client-supplied, and a Markdown file uploaded as `application/octet-stream`
 * is still worth diffing. A NUL byte or invalid UTF-8 means binary.
 */
export function decodeVersionText(
  version: Pick<DiffableVersion, "storageMode" | "contentInline">,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (version.storageMode !== "inline" || version.contentInline === null) {
    return {
      ok: false,
      reason:
        version.storageMode === "external"
          ? "stored externally — the platform only holds a reference"
          : "hash only — the bytes never left the signer's machine",
    };
  }
  const bytes = Buffer.from(version.contentInline, "base64");
  if (bytes.includes(0)) {
    return { ok: false, reason: "binary content" };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // TextDecoder substitutes U+FFFD for invalid sequences. Round-tripping tells
  // a genuine replacement character apart from a decoding failure.
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    return { ok: false, reason: "not valid UTF-8 text" };
  }
  return { ok: true, text };
}

/** Split into lines, keeping a trailing newline from becoming a phantom line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Line diff: trim the shared prefix and suffix, then an LCS over what is left.
 *
 * Edits to a document are usually local, so the trimmed middle is small and the
 * quadratic step is cheap in practice. Returns null when the middle is still
 * too large for MAX_DIFF_CELLS.
 */
export function diffLines(
  oldText: string,
  newText: string,
  maxCells: number = MAX_DIFF_CELLS,
): DiffLine[] | null {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const n = midA.length;
  const m = midB.length;

  if (n * m > maxCells) return null;

  // lcs[i][j] = LCS length of midA[i..] and midB[j..], flattened row-major.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * width + (j + 1)]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + (j + 1)]!);
    }
  }

  const out: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  const equal = (text: string) =>
    out.push({ op: "equal", oldLine: oldLine++, newLine: newLine++, text });

  for (let k = 0; k < prefix; k++) equal(a[k]!);

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      equal(midA[i]!);
      i++;
      j++;
    } else if (
      j < m &&
      (i >= n || lcs[i * width + (j + 1)]! >= lcs[(i + 1) * width + j]!)
    ) {
      out.push({
        op: "add",
        oldLine: null,
        newLine: newLine++,
        text: midB[j]!,
      });
      j++;
    } else {
      out.push({
        op: "remove",
        oldLine: oldLine++,
        newLine: null,
        text: midA[i]!,
      });
      i++;
    }
  }

  for (let k = a.length - suffix; k < a.length; k++) equal(a[k]!);

  return out;
}

/**
 * Group a line diff into hunks with `context` unchanged lines around each
 * change, unified-diff style. Equal runs longer than 2×context between changes
 * split the hunk; an all-equal diff yields no hunks.
 */
export function toHunks(
  lines: DiffLine[],
  context: number = DIFF_CONTEXT,
): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.op === "equal" ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    // A hunk's start is the first line number it shows on that side. For a
    // side with no lines in the hunk (pure insert/delete) use the line before
    // it, which is what unified diff does.
    const firstOld = slice.find((l) => l.oldLine !== null)?.oldLine;
    const firstNew = slice.find((l) => l.newLine !== null)?.newLine;
    const priorOld =
      lines
        .slice(0, start)
        .reverse()
        .find((l) => l.oldLine !== null)?.oldLine ?? 0;
    const priorNew =
      lines
        .slice(0, start)
        .reverse()
        .find((l) => l.newLine !== null)?.newLine ?? 0;
    return {
      oldStart: firstOld ?? priorOld,
      oldLines: slice.filter((l) => l.op !== "add").length,
      newStart: firstNew ?? priorNew,
      newLines: slice.filter((l) => l.op !== "remove").length,
      lines: slice,
    };
  });
}

function fieldValue(
  version: DiffableVersion,
  field: DiffedVersionField,
): string | number | null {
  return version[field] ?? null;
}

/**
 * Diff two versions of the same document. `from` is the older one by
 * convention, but nothing depends on that — comparing v5 to v2 is a valid
 * question when reviewing a rollback.
 */
export function diffVersions(
  from: DiffableVersion,
  to: DiffableVersion,
): VersionDiff {
  const fieldChanges: FieldChange[] = DIFFED_VERSION_FIELDS.flatMap((field) => {
    const before = fieldValue(from, field);
    const after = fieldValue(to, field);
    return before === after ? [] : [{ field, from: before, to: after }];
  });

  const contentChanged = from.contentHash !== to.contentHash;
  const summary = {
    from: {
      id: from.id,
      versionNumber: from.versionNumber,
      contentHash: from.contentHash,
    },
    to: {
      id: to.id,
      versionNumber: to.versionNumber,
      contentHash: to.contentHash,
    },
    contentChanged,
    fieldChanges,
  };

  if (!contentChanged) {
    return {
      ...summary,
      content: {
        kind: "identical",
        reason:
          "Both versions have the same content hash, so their bytes are identical.",
      },
    };
  }

  const before = decodeVersionText(from);
  const after = decodeVersionText(to);
  if (!before.ok || !after.ok) {
    const parts = [
      !before.ok ? `v${from.versionNumber}: ${before.reason}` : null,
      !after.ok ? `v${to.versionNumber}: ${after.reason}` : null,
    ].filter(Boolean);
    return {
      ...summary,
      content: {
        kind: "unavailable",
        reason:
          `No line diff — ${parts.join("; ")}. The content hashes differ, ` +
          `so the content did change.`,
      },
    };
  }

  const lines = diffLines(before.text, after.text);
  if (lines === null) {
    return {
      ...summary,
      content: {
        kind: "unavailable",
        reason:
          "The changed region is too large to diff here. The content hashes " +
          "differ, so the content did change.",
      },
    };
  }

  return {
    ...summary,
    content: {
      kind: "text",
      added: lines.filter((l) => l.op === "add").length,
      removed: lines.filter((l) => l.op === "remove").length,
      hunks: toHunks(lines),
    },
  };
}
