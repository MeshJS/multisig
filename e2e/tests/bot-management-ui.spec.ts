// Phase 3 item 9: Bot management UI.
//
// Proves users can manage bot credentials through the /user page. The app's
// bot model is claim-based: a bot registers itself over REST
// (POST /api/v1/botRegister -> pendingBotId + one-time claim code) and the
// user claims it in the UI, approving its requested scopes. The bot's API
// secret is delivered to the bot via botPickupSecret, never shown in the UI,
// so "generated secret shown once" from the original plan maps to the
// one-time claim code + claim flow here.
//
// Coverage:
//   - claim a freshly registered bot (ID + claim code -> review -> success)
//   - the claimed bot appears in the bot list with name, key id, and scopes
//   - the bot's payment address is visible after claiming
//   - edit scopes through the dialog
//   - revoke the bot and confirm it disappears
//
// The spec registers its own pending bot with a unique fake payment address,
// so it never collides with route-chain bots or other workers.

import { test, expect } from "../fixtures/authFixture";

test.describe("bot management UI", () => {
  test("claim, inspect, edit scopes, and revoke a bot", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);

    await authenticateAs(page, 0);

    // Register a pending bot the way a real bot would, over REST.
    const botName = `ci-playwright-bot-${Date.now()}-${test.info().workerIndex}`;
    const paymentAddress = `addr_test1ciplaywrightbot${Date.now()}${test.info().workerIndex}`;
    const registerResponse = await page.request.post("/api/v1/botRegister", {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({
        name: botName,
        paymentAddress,
        requestedScopes: ["multisig:read", "multisig:sign"],
      }),
    });
    expect(
      registerResponse.ok(),
      `botRegister failed ${registerResponse.status()}: ${await registerResponse.text().catch(() => "")}`,
    ).toBe(true);
    const { pendingBotId, claimCode } = (await registerResponse.json()) as {
      pendingBotId: string;
      claimCode: string;
    };
    expect(pendingBotId).toBeTruthy();
    expect(claimCode).toBeTruthy();

    await page.goto("/user");
    await expect(page.getByRole("heading", { name: "Bot accounts" })).toBeVisible({
      timeout: 60_000,
    });

    // Step 1: enter the bot id and claim code.
    await page.getByRole("button", { name: "Claim a bot" }).click();
    await page.getByLabel("Bot ID").fill(pendingBotId);
    await page.getByLabel("Claim code").fill(claimCode);
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2: review shows the bot's identity and requested scopes.
    await expect(page.getByText(botName)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Requested scopes")).toBeVisible();
    await expect(page.locator("#claim-scope-multisig\\:read")).toBeChecked();
    await expect(page.locator("#claim-scope-multisig\\:sign")).toBeChecked();
    // Scopes the bot did not request cannot be approved.
    await expect(page.locator("#claim-scope-ballot\\:write")).toBeDisabled();

    await page.getByRole("button", { name: "Claim bot" }).click();

    // Step 3: success confirmation, then the bot shows up in the list.
    await expect(page.getByText("Bot claimed successfully")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Done" }).click();

    // Toasts also render as <li> and the claim toast contains the bot name,
    // so anchor the row on its Edit scopes action.
    const botRow = page
      .locator("li", { hasText: botName })
      .filter({ has: page.getByRole("button", { name: "Edit scopes" }) });
    await expect(botRow).toBeVisible({ timeout: 30_000 });
    await expect(botRow.getByText("multisig:read")).toBeVisible({
      timeout: 30_000,
    });
    await expect(botRow.getByText("multisig:sign")).toBeVisible();
    await expect(botRow.getByText("Key ID")).toBeVisible();
    // The payment address row appears once the bot user record is linked.
    await expect(botRow.getByText("Bot address")).toBeVisible();

    // Edit scopes: drop the sign scope, keep read.
    await botRow.getByRole("button", { name: "Edit scopes" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit scopes" }),
    ).toBeVisible();
    await page.locator("#edit-scope-multisig\\:sign").click();
    const updateScopesResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("bot.updateBotKeyScopes") &&
        response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const updateScopesResponse = await updateScopesResponsePromise;
    expect(
      updateScopesResponse.ok(),
      `bot.updateBotKeyScopes failed ${updateScopesResponse.status()}`,
    ).toBe(true);

    await expect(botRow.getByText("multisig:read")).toBeVisible({
      timeout: 30_000,
    });
    await expect(botRow.getByText("multisig:sign")).toHaveCount(0, {
      timeout: 30_000,
    });

    // Revoke: the delete action asks for a native confirm() first.
    page.once("dialog", (dialog) => void dialog.accept());
    // The delete button is icon-only; it is the row's only destructive action.
    await botRow.locator("button.text-destructive").click();
    await expect(page.getByText("Bot revoked").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(botRow).toHaveCount(0, { timeout: 30_000 });
  });
});
