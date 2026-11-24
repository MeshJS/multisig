import { test, expect, type Page } from "@playwright/test";

async function expectTheme(page: Page, scheme: "dark" | "light") {
  if (scheme === "dark") {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  } else {
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  }
  // A correct root class alone missed the regression: the wallet-flow wrapper
  // made the body transparent, exposing a white canvas beneath dark content.
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    scheme === "dark" ? "rgb(18, 18, 18)" : "rgb(255, 255, 255)",
  );
}

for (const backgroundMode of ["off", "reduced"] as const) {
  for (const colorScheme of ["dark", "light"] as const) {
    test.describe(`${colorScheme} theme with ${backgroundMode} effects`, () => {
      test.use({ colorScheme });

      test("preserves the browser theme through footer import navigation", async ({
        page,
      }) => {
        await page.addInitScript((mode) => {
          localStorage.setItem(
            "appearance-settings",
            JSON.stringify({
              state: { backgroundMode: mode, backgroundPreset: "aurora" },
              version: 2,
            }),
          );
        }, backgroundMode);

        await page.goto("/");
        await expectTheme(page, colorScheme);
        // The site footer is inside <main>, so it has no implicit contentinfo role.
        await page
          .locator("footer")
          .getByRole("link", { name: "Import a wallet", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Import Wallet", exact: true }),
        ).toBeVisible();
        await expect(page.locator("body")).toHaveClass(/add-wallet-glass-page/);
        await expectTheme(page, colorScheme);

        // Direct entry/reload must behave the same as client-side navigation.
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "Import Wallet", exact: true }),
        ).toBeVisible();
        await expect(page.locator("body")).toHaveClass(/add-wallet-glass-page/);
        await expectTheme(page, colorScheme);

        const changedScheme = colorScheme === "dark" ? "light" : "dark";
        await page.emulateMedia({ colorScheme: changedScheme });
        await expectTheme(page, changedScheme);
        await page.goBack();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator("body")).not.toHaveClass(
          /add-wallet-glass-page/,
        );
        await expectTheme(page, changedScheme);
      });
    });
  }
}
