import { expect, type Page } from "@playwright/test";

export async function openHelpMenu(page: Page) {
  const menu = page.getByRole("menu", { name: "Help & resources" });
  if (!(await menu.isVisible())) {
    await page
      .getByRole("button", { name: "Help & resources", exact: true })
      .click();
  }
  await expect(menu).toBeVisible();
  return menu;
}
