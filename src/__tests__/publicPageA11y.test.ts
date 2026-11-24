import React from "react";
import ReactDOMServer from "react-dom/server";

import * as previews from "@/components/pages/homepage/previews";
import Pagination from "@/components/common/overall-layout/pagination";
import FileDrop from "@/components/pages/wallet/documents/file-drop";
import { VaultGraphView } from "@/components/pages/homepage/roadmap/graph";
import { loadVaultGraph } from "@/lib/vault";

/**
 * Each case here is an axe-core WCAG 2 A/AA violation that was live on a public
 * page (/, /features, /governance/drep, /verify, /roadmap/graph). They guard the
 * markup that fixes it, so a refactor can't quietly bring the violation back.
 */

const render = (element: React.ReactElement) =>
  ReactDOMServer.renderToStaticMarkup(element);

/** Opening tags of every element that a keyboard user can Tab to. */
function tabStops(html: string): string[] {
  const tags = html.match(/<(button|a|input|select|textarea)\b[^>]*>|<[a-z]+\b[^>]*\btabindex="\d+"[^>]*>/g) ?? [];
  return tags.filter((tag) => {
    if (/\btabindex="-1"/.test(tag)) return false;
    if (/^<a\b/.test(tag)) return /\bhref=/.test(tag);
    if (/^<input\b/.test(tag)) return !/\btype="hidden"/.test(tag);
    return true;
  });
}

describe("landing-page product previews (/ and /features)", () => {
  const components: Array<[string, () => React.ReactElement]> = Object.entries(
    previews,
  ).filter(([, value]) => typeof value === "function");

  it("exports the previews this suite is meant to cover", () => {
    expect(components.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        "CreateTransactionPreview",
        "DRepPreview",
        "StakingPreview",
      ]),
    );
  });

  it.each(components)(
    "%s is aria-hidden and has no Tab stop inside it",
    (_name, Component) => {
      const html = render(React.createElement(Component));
      // The frame hides the preview from screen readers, so anything focusable
      // inside it would be a Tab stop that announces as nothing.
      expect(html).toMatch(/^<div\b[^>]*\baria-hidden="true"/);
      expect(tabStops(html)).toEqual([]);
    },
  );

  it("still renders the mock buttons, just out of the tab order", () => {
    const html = render(React.createElement(previews.StakingPreview));
    expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*>.*Withdraw rewards/);
  });
});

describe("Pagination page-size select (/governance/drep and wallet lists)", () => {
  const html = render(
    React.createElement(Pagination, {
      currentPage: 1,
      setCurrentPage: () => undefined,
      pageSize: 50,
      setPageSize: () => undefined,
      order: "desc",
      setOrder: () => undefined,
      onLastPage: false,
    }),
  );
  const trigger = html.match(/<button[^>]*role="combobox"[^>]*>.*?<\/button>/)?.[0];

  it("shows the current page size in the server-rendered trigger", () => {
    expect(trigger).toBeDefined();
    expect(trigger).toContain("50 / page");
  });

  it("has an accessible name that contains its visible text", () => {
    expect(trigger).toContain('aria-label="Rows per page: 50 / page"');
  });
});

describe("FileDrop (/verify and document versions)", () => {
  const html = render(React.createElement(FileDrop, { onFile: () => undefined }));

  it("offers exactly one Tab stop: the labelled 'Choose a file' button", () => {
    const stops = tabStops(html);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatch(/^<button\b/);
    expect(html).toContain("Choose a file");
  });

  it("keeps the backing file input out of the tab order and the a11y tree", () => {
    const input = html.match(/<input[^>]*type="file"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input).toContain('tabindex="-1"');
    expect(input).toContain('aria-hidden="true"');
  });
});

describe("feature graph (/roadmap/graph)", () => {
  const html = render(
    React.createElement(VaultGraphView, { graph: loadVaultGraph() }),
  );
  const svg = html.match(/<svg[^>]*aria-label="Knowledge graph[^>]*>/)?.[0];

  it("is a labelled group, not an img that hides the node buttons inside it", () => {
    expect(svg).toBeDefined();
    expect(svg).toContain('role="group"');
    expect(svg).not.toContain('role="img"');
  });

  it("exposes each note as a focusable, labelled button", () => {
    const nodes = html.match(/<g[^>]*role="button"[^>]*>/g) ?? [];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node).toContain('tabindex="0"');
      expect(node).toMatch(/aria-label="[^"]+"/);
    }
  });
});
