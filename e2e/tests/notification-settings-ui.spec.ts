// Phase 3 item 10: Notification center.
//
// The app's signature notifications are email-based: each signer manages
// per-wallet email preferences on the wallet info page, and a server-side
// outbox/worker sends "signature required" emails whose links land on the
// wallet's transactions page. There is no in-app notification inbox, so the
// browser coverage targets the notification settings surface:
//   - the Email Notifications card loads for a wallet signer
//   - saving an email persists it and flips the badge to "Not verified"
//   - the verification email action is offered once an email is saved
//     (in test environments delivery is disabled and the API reports the
//     email as "prepared" instead of "queued")
//   - preference toggles persist across a reload
//
// The email delivery pipeline itself (outbox rows, worker, verify link) is
// server-side and covered outside the browser suite.

import { test, expect } from "../fixtures/authFixture";
import { loadContext } from "../helpers/contextLoader";
import { createThrowawayWallet } from "../helpers/apiHelpers";
import { mockWalletUtxos } from "../helpers/phase3Mocks";

test.describe("notification settings UI", () => {
  test("signer saves an email, sees verification state, and toggles persist", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E notifications ${Date.now()}-${test.info().workerIndex}`,
    );
    await mockWalletUtxos(page);

    await page.goto(`/wallets/${wallet.walletId}/info`);
    await expect(
      page.getByRole("heading", { name: "Email Notifications" }),
    ).toBeVisible({ timeout: 60_000 });

    // Fresh wallet+signer pair: no email is stored yet.
    await expect(page.getByText("No email", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // Save an email address.
    const email = `ci-playwright-${Date.now()}@example.com`;
    const emailInput = page.getByLabel("Email address");
    await expect(emailInput).toBeEnabled({ timeout: 30_000 });
    await emailInput.fill(email);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Notification settings saved").first()).toBeVisible({
      timeout: 30_000,
    });

    // Saved but unverified: badge flips and the verification action unlocks.
    await expect(page.getByText("Not verified", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(email)).toBeVisible();
    const sendVerification = page.getByRole("button", {
      name: "Send verification email",
    });
    await expect(sendVerification).toBeEnabled({ timeout: 30_000 });
    await sendVerification.click();
    await expect(
      page.getByText(/Verification email (queued|prepared)/).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Turn off transaction-signature emails; the change persists server-side.
    const transactionsToggle = page.getByRole("switch", {
      name: "Toggle transaction signature notifications",
    });
    await expect(transactionsToggle).toBeEnabled({ timeout: 30_000 });
    await expect(transactionsToggle).toHaveAttribute("aria-checked", "true");
    await transactionsToggle.click();
    await expect(page.getByText("Notification settings saved").first()).toBeVisible({
      timeout: 30_000,
    });

    // The threshold-reached and ballot-deadline toggles persist the same way.
    const thresholdToggle = page.getByRole("switch", {
      name: "Toggle threshold reached notifications",
    });
    await expect(thresholdToggle).toBeEnabled({ timeout: 30_000 });
    await expect(thresholdToggle).toHaveAttribute("aria-checked", "true");
    await thresholdToggle.click();
    await expect(page.getByText("Notification settings saved").first()).toBeVisible({
      timeout: 30_000,
    });
    const ballotToggle = page.getByRole("switch", {
      name: "Toggle ballot deadline notifications",
    });
    await expect(ballotToggle).toBeEnabled({ timeout: 30_000 });
    await expect(ballotToggle).toHaveAttribute("aria-checked", "true");
    await ballotToggle.click();
    await expect(page.getByText("Notification settings saved").first()).toBeVisible({
      timeout: 30_000,
    });

    // Everything survives a full reload: email, badge, and the toggles.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Email Notifications" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Not verified", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByLabel("Email address")).toHaveValue(email, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("switch", {
        name: "Toggle transaction signature notifications",
      }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
    await expect(
      page.getByRole("switch", { name: "Toggle threshold reached notifications" }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
    await expect(
      page.getByRole("switch", { name: "Toggle ballot deadline notifications" }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  });
});
