import { test, expect } from "@playwright/test";

for (const width of [375, 1280]) {
  test.describe(`public resources at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("legacy links preserve queries and scroll to developer content", async ({
      page,
    }) => {
      await page.goto("/?source=legacy#developers-and-bots");
      await expect(page).toHaveURL(
        /\/about\?source=legacy#developers-and-bots$/,
      );
      const section = page.locator("#developers-and-bots");
      await expect(section).toBeVisible();
      await expect
        .poll(async () =>
          section.evaluate((element) => {
            const main = document.getElementById("main-content")!;
            return Math.abs(
              element.getBoundingClientRect().top -
                main.getBoundingClientRect().top,
            );
          }),
        )
        .toBeLessThan(5);
      await page
        .getByRole("link", { name: "Read the full MCP setup guide" })
        .click();
      await expect(
        page.getByRole("heading", { name: "MCP setup guide", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("transaction_preview", { exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(
        /\/about\?source=legacy#developers-and-bots$/,
      );
      await page.goForward();
      await expect(page).toHaveURL(/\/docs\/mcp$/);
    });

    test("direct MCP fragments work on both landing URLs", async ({ page }) => {
      for (const path of ["/", "/about"]) {
        await page.goto(`${path}?source=help#connect-mcp`);
        await expect(page).toHaveURL(/\/docs\/mcp\?source=help$/);
        await expect(
          page.getByRole("heading", { name: "MCP setup guide", exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "MCP setup guide", exact: true }),
        ).toBeVisible();
      }
    });

    test("later hash navigation migrates without changing ordinary root visits", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator("#developers-and-bots")).toBeAttached();
      await expect(page).toHaveURL(/\/$/);
      await page.evaluate(() => {
        window.location.hash = "connect-mcp";
      });
      await expect(page).toHaveURL(/\/docs\/mcp$/);
    });
  });
}
