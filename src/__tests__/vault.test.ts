import {
  extractWikilinks,
  loadVaultGraph,
  splitFrontmatter,
  summarize,
  FEATURE_STATES,
} from "@/lib/vault";

describe("splitFrontmatter", () => {
  it("parses scalars, inline arrays and block lists", () => {
    const { frontmatter, body } = splitFrontmatter(
      [
        "---",
        "type: feature",
        "state: delivered",
        "issues: [122, 213]",
        "code_paths:",
        "  - src/lib/vault.ts",
        "  - src/pages/roadmap",
        "empty: []",
        "---",
        "",
        "# Title",
        "",
        "Body text.",
      ].join("\n"),
    );

    expect(frontmatter.type).toBe("feature");
    expect(frontmatter.state).toBe("delivered");
    expect(frontmatter.issues).toEqual(["122", "213"]);
    expect(frontmatter.code_paths).toEqual([
      "src/lib/vault.ts",
      "src/pages/roadmap",
    ]);
    expect(frontmatter.empty).toEqual([]);
    expect(body).toContain("# Title");
  });

  it("strips matching quotes but leaves inner punctuation alone", () => {
    const { frontmatter } = splitFrontmatter(
      ['---', 'owner: "Quirin & Andre"', "area: 'Platform & UX'", "---", ""].join(
        "\n",
      ),
    );
    expect(frontmatter.owner).toBe("Quirin & Andre");
    expect(frontmatter.area).toBe("Platform & UX");
  });

  it("returns an empty result for a note with no frontmatter", () => {
    const { frontmatter, body } = splitFrontmatter("# Just a heading\n\nText.");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just a heading\n\nText.");
  });

  it("does not treat an unterminated fence as frontmatter", () => {
    const { frontmatter } = splitFrontmatter("---\ntype: feature\nno end fence");
    expect(frontmatter).toEqual({});
  });

  it("handles CRLF line endings", () => {
    const { frontmatter } = splitFrontmatter(
      "---\r\ntype: feature\r\nstate: blocked\r\n---\r\n\r\nBody.",
    );
    expect(frontmatter.state).toBe("blocked");
  });
});

describe("extractWikilinks", () => {
  it("collects links, de-duplicates them and drops aliases and anchors", () => {
    expect(
      extractWikilinks(
        "See [[Alpha]] and [[Beta|the second]] and [[Alpha]] and [[Gamma#section]].",
      ),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("returns nothing when there are no links", () => {
    expect(extractWikilinks("Plain prose with [a link](https://x.dev).")).toEqual(
      [],
    );
  });
});

describe("summarize", () => {
  it("uses the first paragraph, dropping the heading and link syntax", () => {
    expect(
      summarize("# Title\n\nFirst para with [[A Link]] and `code`.\n\nSecond."),
    ).toBe("First para with A Link and code.");
  });
});

describe("loadVaultGraph", () => {
  const graph = loadVaultGraph();

  it("loads features, areas and states from the vault", () => {
    const kinds = graph.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === "feature").length).toBeGreaterThan(0);
    expect(kinds.filter((k) => k === "area").length).toBeGreaterThan(0);
    expect(kinds.filter((k) => k === "state")).toHaveLength(
      FEATURE_STATES.length,
    );
  });

  it("gives every feature exactly one area edge and one state edge", () => {
    const features = graph.nodes.filter((n) => n.kind === "feature");
    for (const feature of features) {
      const area = graph.edges.filter(
        (e) => e.source === feature.id && e.kind === "in-area",
      );
      const state = graph.edges.filter(
        (e) => e.source === feature.id && e.kind === "has-state",
      );
      expect(area).toHaveLength(1);
      expect(state).toHaveLength(1);
    }
  });

  it("only emits edges between nodes that exist", () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it("de-duplicates mutual references into a single relates-to edge", () => {
    const pairs = graph.edges
      .filter((e) => e.kind === "relates-to")
      .map((e) => [e.source, e.target].sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("never links a feature to itself", () => {
    for (const edge of graph.edges) {
      expect(edge.source).not.toBe(edge.target);
    }
  });

  it("counts features by state consistently with the nodes", () => {
    for (const state of FEATURE_STATES) {
      const actual = graph.nodes.filter(
        (n) => n.kind === "feature" && n.state === state,
      ).length;
      expect(graph.counts[state]).toBe(actual);
    }
  });

  it("gives every feature a non-empty summary", () => {
    for (const feature of graph.nodes.filter((n) => n.kind === "feature")) {
      expect(feature.summary.length).toBeGreaterThan(0);
    }
  });

  it("records degree matching the edges that touch each node", () => {
    for (const node of graph.nodes) {
      const touching = graph.edges.filter(
        (e) => e.source === node.id || e.target === node.id,
      ).length;
      expect(node.degree).toBe(touching);
    }
  });
});
