# Feature Vault

An Obsidian-compatible vault describing **every feature of Mesh Multisig and the
state it is in**. It is the source of data for the interactive knowledge graph at
[`/roadmap/graph`](../src/pages/roadmap/graph.tsx), parsed at build time by
[`src/lib/vault.ts`](../src/lib/vault.ts).

Open this folder directly in Obsidian — it uses plain markdown, YAML frontmatter
and `[[wikilinks]]`, with no plugins required.

## Layout

| Folder | Note type | What it is |
|--------|-----------|------------|
| `features/` | `feature` | One note per feature, carrying the state it is in |
| `areas/` | `area` | The workstreams features belong to |
| `states/` | `state` | The four states a feature can be in |

## Frontmatter

Every feature note carries:

```yaml
---
type: feature
area: Governance          # must match an areas/ note title
state: delivered          # delivered | in-progress | planned | blocked
owner: Quirin             # Quirin | Andre | Quirin & Andre | (omitted)
milestone: 2026-06        # YYYY-MM the work landed or is scheduled for
issues: [122]             # GitHub issue numbers
prs: [272, 296]           # GitHub PR numbers
updated: 2026-07-27
---
```

`area` and `state` become edges to the corresponding note, and every `[[wikilink]]`
in the body becomes an edge between features. That is the whole graph model — there
is no separate index to keep in sync.

## Editing

Add a feature by copying any note in `features/`, or change a state by editing one
`state:` line. The graph picks it up on the next build. Keep titles stable: a note's
filename is its node id, and wikilinks resolve by title.

The narrative roadmap lives in [`ROADMAP.md`](../ROADMAP.md); this vault is the
structured view of the same work. When a feature ships, update both.
