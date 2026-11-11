import type { Page, TestInfo } from "@playwright/test";

/** Compare the same fixture with the documented pre-fix layout rules.
 * This is a CSS reconstruction, not a screenshot of an old deployed build. */
export async function captureLayoutComparison(
  page: Page,
  info: TestInfo,
  name: string,
  beforeCss: string,
) {
  const anchor =
    name === "bot-grants" ? page.getByTestId("bot-grant-controls") : null;
  if (anchor) await anchor.scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath(`${name}-after.png`),
  });
  const style = await page.addStyleTag({ content: beforeCss });
  try {
    if (anchor) await anchor.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: "disabled",
      path: info.outputPath(`${name}-before-css-reconstruction.png`),
    });
  } finally {
    await style.evaluate((node) => node.parentNode?.removeChild(node));
  }
}
