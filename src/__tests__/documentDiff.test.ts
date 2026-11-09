import { describe, expect, it } from "@jest/globals";

import {
  decodeVersionText,
  diffLines,
  diffVersions,
  splitLines,
  toHunks,
  type DiffableVersion,
} from "@/lib/documents/diff";
import { sha256Hex } from "@/lib/documents/payload";

/**
 * Revision Provenance — version diff.
 *
 * The properties that matter: a line diff that reconstructs both sides
 * exactly, honest refusal when the platform does not hold the bytes, and no
 * line diff ever claiming two different hashes are "the same".
 */

function inline(
  id: string,
  versionNumber: number,
  text: string,
  extra: Partial<DiffableVersion> = {},
): DiffableVersion {
  const bytes = Buffer.from(text, "utf8");
  return {
    id,
    versionNumber,
    contentHash: sha256Hex(bytes),
    fileName: "contract.md",
    mimeType: "text/markdown",
    fileSize: bytes.length,
    storageMode: "inline",
    contentRef: null,
    contentInline: bytes.toString("base64"),
    reviewInstructions: null,
    ...extra,
  };
}

/** Rebuild each side from a diff — the strongest check that it is correct. */
function sides(text: { old: string; new: string }) {
  const lines = diffLines(text.old, text.new)!;
  return {
    lines,
    old: lines.filter((l) => l.op !== "add").map((l) => l.text),
    new: lines.filter((l) => l.op !== "remove").map((l) => l.text),
  };
}

describe("splitLines", () => {
  it("does not invent a line for a trailing newline", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    // \r stays on its line, so a line-ending change is a visible change.
    expect(splitLines("a\r\nb")).toEqual(["a\r", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("diffLines", () => {
  it("reconstructs both sides exactly", () => {
    const cases = [
      { old: "a\nb\nc\n", new: "a\nB\nc\n" },
      { old: "", new: "x\ny\n" },
      { old: "x\ny\n", new: "" },
      { old: "1\n2\n3\n4\n5\n", new: "0\n1\n3\n4\n6\n5\n" },
      { old: "same\n", new: "same\n" },
    ];
    for (const c of cases) {
      const r = sides(c);
      expect(r.old).toEqual(splitLines(c.old));
      expect(r.new).toEqual(splitLines(c.new));
    }
  });

  it("numbers lines on each side", () => {
    const { lines } = sides({ old: "a\nb\nc\n", new: "a\nX\nc\n" });
    expect(lines).toEqual([
      { op: "equal", oldLine: 1, newLine: 1, text: "a" },
      { op: "remove", oldLine: 2, newLine: null, text: "b" },
      { op: "add", oldLine: null, newLine: 2, text: "X" },
      { op: "equal", oldLine: 3, newLine: 3, text: "c" },
    ]);
  });

  it("keeps a minimal edit for a one-word change in a long document", () => {
    const body = Array.from({ length: 2000 }, (_, i) => `clause ${i}`);
    const changed = [...body];
    changed[1000] = "clause 1000 (amended)";
    const lines = diffLines(body.join("\n"), changed.join("\n"))!;
    expect(lines.filter((l) => l.op !== "equal")).toHaveLength(2);
  });

  it("gives up rather than stalling when the changed region is huge", () => {
    const a = Array.from({ length: 300 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 300 }, (_, i) => `b${i}`).join("\n");
    expect(diffLines(a, b, 1000)).toBeNull();
  });
});

describe("toHunks", () => {
  it("returns no hunks for identical text", () => {
    expect(toHunks(diffLines("a\nb\n", "a\nb\n")!)).toEqual([]);
  });

  it("splits distant changes and keeps three lines of context", () => {
    const old = Array.from({ length: 30 }, (_, i) => `l${i + 1}`);
    const next = [...old];
    next[1] = "CHANGED 2";
    next[25] = "CHANGED 26";
    const hunks = toHunks(diffLines(old.join("\n"), next.join("\n"))!);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(hunks[1]).toMatchObject({ oldStart: 23, newStart: 23 });
    // 3 context + remove + add + 3 context
    expect(hunks[1]!.lines).toHaveLength(8);
  });
});

describe("decodeVersionText", () => {
  it("refuses bytes the platform never held", () => {
    const r = decodeVersionText({
      storageMode: "hashOnly",
      contentInline: null,
    });
    expect(r).toEqual({
      ok: false,
      reason: expect.stringMatching(/hash only/),
    });
  });

  it("refuses binary and invalid UTF-8 rather than mangling it", () => {
    expect(
      decodeVersionText({
        storageMode: "inline",
        contentInline: Buffer.from([0x25, 0x50, 0x00, 0x46]).toString("base64"),
      }).ok,
    ).toBe(false);
    expect(
      decodeVersionText({
        storageMode: "inline",
        contentInline: Buffer.from([0xc3, 0x28]).toString("base64"),
      }).ok,
    ).toBe(false);
  });

  it("keeps a byte-order mark as text instead of rejecting the file", () => {
    const r = decodeVersionText({
      storageMode: "inline",
      contentInline: Buffer.from([0xef, 0xbb, 0xbf, 0x61]).toString("base64"),
    });
    expect(r).toEqual({ ok: true, text: "\uFEFFa" });
  });

  it("keeps a genuine replacement character", () => {
    const r = decodeVersionText({
      storageMode: "inline",
      contentInline: Buffer.from("ok � ok", "utf8").toString("base64"),
    });
    expect(r).toEqual({ ok: true, text: "ok � ok" });
  });
});

describe("diffVersions", () => {
  it("diffs two inline text versions", () => {
    const d = diffVersions(
      inline("v1", 1, "# Supply\n\nCeiling: 50000 EUR\n"),
      inline("v2", 2, "# Supply\n\nCeiling: 125000 EUR\n"),
    );
    expect(d.contentChanged).toBe(true);
    expect(d.fieldChanges.map((c) => c.field)).toEqual([
      "contentHash",
      "fileSize",
    ]);
    expect(d.content).toMatchObject({ kind: "text", added: 1, removed: 1 });
  });

  it("calls same-hash versions identical, whatever else changed", () => {
    const a = inline("v2", 2, "body\n");
    const b = {
      ...a,
      id: "v5",
      versionNumber: 5,
      reviewInstructions: "re-approve",
    };
    const d = diffVersions(a, b);
    expect(d.contentChanged).toBe(false);
    expect(d.content.kind).toBe("identical");
    expect(d.fieldChanges).toEqual([
      { field: "reviewInstructions", from: null, to: "re-approve" },
    ]);
  });

  it("shows a line-ending change instead of an empty diff", () => {
    const d = diffVersions(
      inline("v1", 1, "a\r\nb\r\n"),
      inline("v2", 2, "a\nb\n"),
    );
    expect(d.content).toMatchObject({ kind: "text", added: 2, removed: 2 });
  });

  it("explains a trailing-newline-only change rather than showing nothing", () => {
    const d = diffVersions(inline("v1", 1, "a\nb"), inline("v2", 2, "a\nb\n"));
    expect(d.contentChanged).toBe(true);
    expect(d.content).toEqual({
      kind: "unavailable",
      reason: expect.stringMatching(/trailing newline/),
    });
  });

  it("still reports a change between hash-only versions, without a line diff", () => {
    const hashOnly = (
      id: string,
      n: number,
      hash: string,
    ): DiffableVersion => ({
      ...inline(id, n, ""),
      contentHash: hash,
      storageMode: "hashOnly",
      contentInline: null,
      fileSize: 10,
    });
    const d = diffVersions(
      hashOnly("v1", 1, "a".repeat(64)),
      hashOnly("v2", 2, "b".repeat(64)),
    );
    expect(d.contentChanged).toBe(true);
    expect(d.content).toEqual({
      kind: "unavailable",
      reason: expect.stringMatching(/hash only.*did change/s),
    });
  });
});
