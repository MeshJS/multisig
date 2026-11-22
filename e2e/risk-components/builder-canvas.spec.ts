import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const artifacts = path.join(root, "ci-artifacts/builder-canvas");

test.beforeAll(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const bundled = require("next/dist/compiled/webpack/webpack");
  bundled.init?.();
  await new Promise<void>((resolve, reject) => {
    const compiler = bundled.webpack({
      mode: "development",
      devtool: false,
      entry: path.join(root, "e2e/risk-components/builder-canvas-harness.tsx"),
      output: { path: artifacts, filename: "harness.js" },
      resolve: {
        extensions: [".tsx", ".ts", ".js", ".mjs"],
        alias: { "@": path.join(root, "src") },
      },
      // The builder store reads process.env for its network defaults.
      plugins: [
        new bundled.webpack.DefinePlugin({
          "process.env": JSON.stringify({ NODE_ENV: "development" }),
        }),
      ],
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: path.join(root, "e2e/risk-components/ts-loader.cjs"),
          },
          // Visibility is an inline style; the React Flow stylesheet is not needed.
          { test: /\.css$/, type: "asset/source" },
        ],
      },
    });
    compiler.run(
      (
        error: Error | undefined,
        stats: { hasErrors(): boolean; toString(): string },
      ) => {
        compiler.close(() => {});
        if (error || stats.hasErrors())
          reject(error ?? new Error(stats.toString()));
        else resolve();
      },
    );
  });
  fs.writeFileSync(
    path.join(artifacts, "index.html"),
    '<!doctype html><div id="root"></div><script src="harness.js"></script>',
  );
});

async function hiddenCards(page: Page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll(".react-flow__node")].filter(
        (node) => getComputedStyle(node).visibility === "hidden",
      ).length,
  );
}

// React Flow hides a card until it is measured. The builder used to drop the
// measurement on every layout recompute, and a burst of recomputes could
// leave every card (and so every edge) hidden for good: the deep-link e2e
// flake on #449, where the Signer 1 output never became clickable.
test("builder cards stay visible and wired through bursts of layout recomputes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`file://${path.join(artifacts, "index.html")}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  // React Flow only renders an edge once both of its handles are measured.
  const initialEdges = await page.locator(".react-flow__edge").count();
  expect(initialEdges).toBeGreaterThan(0);

  for (let round = 1; round <= 4; round += 1) {
    // A new recipient changes the tx card's ports and adds a fresh card.
    await page.evaluate(async () => {
      window.addRecipient();
      await window.recompute(40);
    });
    await expect
      .poll(() => hiddenCards(page), { message: `round ${round}` })
      .toBe(0);
    // Each new recipient adds exactly one tx → recipient edge.
    await expect(page.locator(".react-flow__edge")).toHaveCount(
      initialEdges + round,
    );
  }
  await expect(
    page.locator('[data-testid^="tx-flow-node-draftout:"]').first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
