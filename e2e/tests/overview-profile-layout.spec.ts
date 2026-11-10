import type { Locator } from "@playwright/test";
import { test, expect } from "../fixtures/authFixture";
import { mockNavigationWallets } from "../helpers/navigationWallet";
import { getWallet, loadContext } from "../helpers/contextLoader";

const longName = "Treasury" + "LongWalletIdentifier".repeat(8);
const client = "Assistant" + "LongClientIdentifier".repeat(8);

// Scroll each target into view and check every intermediate clipping ancestor,
// rather than accepting a page whose outer overflow happens to be hidden.
async function contained(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  expect(await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.left < -1 || r.right > innerWidth + 1) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) {
        const b = p.getBoundingClientRect();
        if (r.left < b.left - 1 || r.right > b.right + 1) return false;
      }
    }
    return true;
  })).toBe(true);
}

for (const width of [375, 412, 768, 820, 1024, 1280, 1440]) {
  for (const populated of [false, true]) {
    test(`Overview and bot grants ${populated ? "populated" : "empty"} at ${width}px`, async ({ page, authenticateAs }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await authenticateAs(page, 0);
      const context = loadContext();
      const id = getWallet(context, "legacy").walletId;
      const reads = {
        "contact.getAll": populated ? [{ id: "contact-fixture", name: longName, address: context.signerAddresses[0], description: longName }] : [],
        "mcp.walletClients": populated ? [{ client, calls: 2, failures: 1, tools: ["wallets"], lastUsedAt: new Date() }] : [],
        "mcp.walletToolUsage": [{ id: "call-fixture", tool: "transaction_preview_" + "long".repeat(30), at: new Date(), durationMs: 123, readOnly: false, outcome: "error" }],
        "bot.listBotKeys": populated ? [{ id: "bot-key-fixture", name: longName, scopes: ["multisig:read", "multisig:write"], createdAt: new Date(), botUser: { id: "bot-fixture", paymentAddress: context.signerAddresses[0], displayName: "Treasury assistant" }, botWalletAccesses: [{ walletId: id, role: "observer" }] }] : [],
      };
      const wallet = await mockNavigationWallets(page, false, reads, longName);
      await page.goto(`/wallets/${wallet.walletId}`);
      const stack = page.getByTestId("overview-stack");
      await expect(stack.getByText("AI client activity", { exact: true })).toBeVisible();
      await expect(stack.getByText("Manage Contacts", { exact: true })).toBeVisible();
      if (populated) {
        await stack.getByRole("button", { name: new RegExp(client) }).click();
        await expect(stack.getByText(/^transaction_preview_/)).toBeVisible();
        await contained(stack.getByText(/^transaction_preview_/));
        await contained(stack.getByRole("button", { name: `Edit ${longName}`, exact: true }));
      } else {
        await expect(stack.getByText(/No AI client has used/)).toBeVisible();
        await expect(stack.getByText("No contacts yet", { exact: true })).toBeVisible();
      }
      const cards = await stack.locator(":scope > *").evaluateAll(els => els.map(el => {
        const r = el.getBoundingClientRect(); return { x: r.x, width: r.width, y: r.y, bottom: r.bottom };
      }).filter(r => r.width > 0));
      expect(cards.length).toBeGreaterThan(7);
      for (let i = 1; i < cards.length; i++) {
        expect(Math.abs(cards[i]!.x - cards[0]!.x)).toBeLessThan(2);
        expect(Math.abs(cards[i]!.width - cards[0]!.width)).toBeLessThan(2);
        expect(cards[i]!.y).toBeGreaterThanOrEqual(cards[i-1]!.bottom);
      }
      for (const card of await stack.locator(":scope > *").all()) await contained(card);
      if (populated && [375, 820, 1440].includes(width)) {
        await stack.getByText("AI client activity", { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("overview.png") });
      }
      await page.goto("/user");
      await expect(page.getByRole("button", { name: "Claim a bot", exact: true })).toBeVisible();
      if (!populated) {
        await expect(page.getByText(/No bots yet/)).toBeVisible();
        return;
      }
      const controls = page.getByTestId("bot-grant-controls");
      const walletSelect = controls.getByRole("combobox", { name: "Multisig wallet", exact: true });
      const roleSelect = controls.getByRole("combobox", { name: "Wallet access role" });
      const action = controls.getByRole("button");
      await expect(action).toHaveText("Role already set");
      await expect(action).toBeDisabled();
      for (const control of [walletSelect, roleSelect, action]) await contained(control);
      const boxes = await Promise.all([walletSelect, roleSelect, action].map(c => c.boundingBox()));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1).toBe(true);
      }
      await walletSelect.click();
      await contained(page.getByRole("listbox"));
      await page.getByRole("option", { name: longName, exact: true }).click();
      await roleSelect.click();
      await contained(page.getByRole("listbox"));
      await page.getByRole("option", { name: "cosigner", exact: true }).click();
      await expect(action).toHaveText("Update role");
      await expect(action).toBeEnabled();
      await contained(page.getByRole("button", { name: "Revoke", exact: true }));
      if ([375, 820, 1440].includes(width)) {
        await controls.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("bot-grants.png") });
      }
      // No grants, revocations, signatures, or broadcasts are submitted.
    });
  }
}

test("grant loading and errors stay usable; advisory bots cannot select cosigner", async ({ page, authenticateAs }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await authenticateAs(page, 0);
  await mockNavigationWallets(page, false, {
    "bot.listBotKeys": [{ id: "advisory-key", name: "Advisory bot", scopes: ["multisig:read"], createdAt: new Date(), botUser: { id: "advisory-bot", paymentAddress: "not-a-wallet-signer", displayName: "Advisory bot" }, botWalletAccesses: [] }],
  });
  let releaseRead!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  await page.route("**/api/trpc/**", async route => {
    if (route.request().url().includes("bot.listBotKeys")) await readGate;
    await route.fallback();
  });
  await page.goto("/user");
  await expect(page.getByText(/Loading bots/)).toBeVisible();
  await contained(page.getByText(/Loading bots/));
  releaseRead();
  const controls = page.getByTestId("bot-grant-controls");
  await controls.getByRole("combobox", { name: "Wallet access role" }).click();
  await expect(page.getByRole("option", { name: "cosigner", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await contained(controls.getByText(/Cosigner requires/));

  let releaseGrant!: () => void;
  const grantGate = new Promise<void>(resolve => { releaseGrant = resolve; });
  // Intercept the mutation completely: exercise pending/error UI without a DB write.
  await page.route("**/api/trpc/bot.grantBotAccess*", async route => {
    await grantGate;
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify([{ error: { json: { message: "Fixture grant denied", code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, path: "bot.grantBotAccess" } } } }]) });
  });
  const grant = controls.getByRole("button", { name: "Grant access" });
  await grant.click();
  await expect(controls.getByRole("button")).toBeDisabled();
  await contained(controls.getByRole("button"));
  releaseGrant();
  await expect(page.getByText("Fixture grant denied", { exact: true })).toBeVisible();
  await expect(grant).toBeEnabled();
  await contained(grant);
});

test("Overview activity and contacts keep their width while loading", async ({ page, authenticateAs }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await authenticateAs(page, 0);
  const wallet = await mockNavigationWallets(page, false, { "contact.getAll": [], "mcp.walletClients": [] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/trpc/**", async route => {
    if (/contact\.getAll|mcp\.walletClients/.test(route.request().url())) await gate;
    await route.fallback();
  });
  await page.goto(`/wallets/${wallet.walletId}`);
  const stack = page.getByTestId("overview-stack");
  await expect(stack.getByText(/Loading activity/)).toBeVisible();
  await expect(stack.getByText(/Loading contacts/)).toBeVisible();
  await contained(stack.getByText(/Loading activity/));
  await contained(stack.getByText(/Loading contacts/));
  release();
  await expect(stack.getByText(/No AI client has used/)).toBeVisible();
  await expect(stack.getByText("No contacts yet", { exact: true })).toBeVisible();
});
