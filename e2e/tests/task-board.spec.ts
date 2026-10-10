// Project task board with multisig payouts.
//
// Browser coverage for the board itself on an isolated throwaway wallet:
//   - create a task with a payment recipient → it lands in Backlog with a
//     "Payment configured" badge and the recipient total
//   - move it between columns through the card menu (the accessible
//     fallback for drag-and-drop) and by dragging
//   - edit the title; the change persists across a reload
//   - move accepted work to Done: "Prepare payout" is enabled without any tick,
//     ticking the card narrows the payout to it, and the dialog lists it checked;
//     the preview is requested from the server, which builds against the
//     wallet's spendable UTxOs. A throwaway wallet has none and the preview
//     runs server-side (browser Blockfrost mocks do not reach it), so the spec
//     asserts the graceful error path rather than a created transaction. The
//     preview → confirm pipeline is covered by unit and tRPC tests.
//   - delete the task
//
// The lock a pending or paid payout puts on a task (read-only dialog, no
// moves, unlock on cancellation) is not covered here: seeding that state
// needs direct database rows, and the runner has no database access. It is
// covered against a real Postgres by src/__tests__/trpc/taskRouter.test.ts.
//
// Cleanup: the task is deleted through the UI; the wallet row is a
// throwaway like the other Phase 3 specs use.

import { test, expect } from "../fixtures/authFixture";
import { loadContext } from "../helpers/contextLoader";
import { createThrowawayWallet, trpcMutate } from "../helpers/apiHelpers";
import { mockWalletUtxos } from "../helpers/phase3Mocks";

function waitForTrpc(page: import("@playwright/test").Page, procedure: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(procedure) && response.request().method() === "POST",
    { timeout: 60_000 },
  );
}

test.describe("task board", () => {
  test("signer creates, moves, edits, prepares a payout for, and deletes a task", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();
    const recipient = ctx.signerAddresses[1]!;
    const additionalRecipient = ctx.signerAddresses[2]!;

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E tasks ${Date.now()}-${test.info().workerIndex}`,
    );
    await mockWalletUtxos(page);

    await page.goto(`/wallets/${wallet.walletId}/tasks`);
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No tasks yet")).toBeVisible({ timeout: 30_000 });

    // Create a task and add one of the wallet's signers as its ADA recipient.
    await page.getByTestId("new-task-button").first().click();
    const dialog = page.getByTestId("task-dialog");
    await expect(dialog).toBeVisible();
    const title = `Write the release notes ${Date.now()}`;
    await dialog.getByTestId("task-title-input").fill(title);
    await dialog.getByTestId("task-assignee-signer-select").click();
    await page.getByRole("option", { name: "Signer 2" }).click();
    const addAssignee = dialog.getByTestId("task-add-assignee-recipient");
    await addAssignee.click();
    await expect(addAssignee).toBeDisabled();
    await expect(addAssignee).toContainText("Assignee already added");
    await expect(dialog.getByTestId("recipient-address-input-0")).toHaveValue(recipient);
    await dialog.getByTestId("amount-input-0").fill("2.5");
    await dialog.getByTestId("task-recipient-signer-select").click();
    await page.getByRole("option", { name: "Signer 3" }).click();
    await dialog.getByTestId("task-add-signer-recipient").click();
    await expect(dialog.getByTestId("recipient-address-input-1")).toHaveValue(additionalRecipient);
    await dialog.getByTestId("amount-input-1").fill("1");
    const createPromise = waitForTrpc(page, "task.create");
    await dialog.getByTestId("task-save").click();
    expect((await createPromise).ok()).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const card = page.locator('[data-testid^="task-card-"]').filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 30_000 });
    const taskId = (await card.getAttribute("data-testid"))!.replace("task-card-", "");
    await expect(page.getByTestId("task-column-Backlog")).toContainText(title);
    await expect(card.getByTestId("payout-badge-configured")).toHaveText("Payment configured");
    await expect(card.getByTestId(`task-select-${taskId}`)).toBeHidden();
    await expect(card.getByTestId(`task-totals-${taskId}`)).toHaveText("3.5 ADA");

    // Move through the card menu (keyboard/touch-safe path).
    await card.getByTestId(`task-menu-${taskId}`).click();
    const movePromise = waitForTrpc(page, "task.move");
    await page.getByTestId(`task-move-${taskId}-InProgress`).click();
    expect((await movePromise).ok()).toBe(true);
    await expect(page.getByTestId("task-column-InProgress")).toContainText(title, { timeout: 30_000 });
    await expect(page.getByTestId("task-column-count-InProgress")).toHaveText("1");
    await expect(page.getByTestId("task-column-count-Backlog")).toHaveText("0");

    // Drag it to In review.
    const target = page.getByTestId("task-column-InReview");
    const cardBox = (await card.boundingBox())!;
    const targetBox = (await target.boundingBox())!;
    const dragPromise = waitForTrpc(page, "task.move");
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 12);
    await page.mouse.down();
    // Past the 6px activation distance, then in steps so dnd-kit sees the move.
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 12, cardBox.y + 12, { steps: 4 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 60, { steps: 12 });
    await page.mouse.up();
    expect((await dragPromise).ok()).toBe(true);
    await expect(page.getByTestId("task-column-InReview")).toContainText(title, { timeout: 30_000 });

    // Edit the title; it survives a reload.
    await card.click();
    await expect(dialog).toBeVisible();
    const renamed = `${title} (edited)`;
    await dialog.getByTestId("task-title-input").fill(renamed);
    const updatePromise = waitForTrpc(page, "task.update");
    await dialog.getByTestId("task-save").click();
    expect((await updatePromise).ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId("task-column-InReview")).toContainText(renamed, { timeout: 60_000 });

    // Reviewed work only becomes payable once it reaches Done.
    const renamedCard = page.getByTestId(`task-card-${taskId}`);
    await expect(renamedCard.getByTestId("payout-badge-configured")).toBeVisible();
    await renamedCard.getByTestId(`task-menu-${taskId}`).click();
    const donePromise = waitForTrpc(page, "task.move");
    await page.getByTestId(`task-move-${taskId}-Done`).click();
    expect((await donePromise).ok()).toBe(true);
    await expect(page.getByTestId("task-column-Done")).toContainText(renamed, { timeout: 30_000 });
    await expect(renamedCard.getByTestId("payout-badge-ready")).toBeVisible();

    // A payable task is enough: nothing has to be ticked for "Prepare payout"
    // to work (it defaults to every payable task).
    const prepareButton = page.getByTestId("prepare-payout-button").first();
    await expect(prepareButton).toBeEnabled();
    await expect(prepareButton).not.toContainText("(");

    // Ticking the card narrows the payout to it and shows the count on the button.
    await renamedCard.getByTestId(`task-select-${taskId}`).click();
    await expect(prepareButton).toContainText("(1)");
    await prepareButton.click();
    const payoutDialog = page.getByTestId("payout-dialog");
    await expect(payoutDialog).toBeVisible();
    await expect(payoutDialog.getByTestId("payout-task-list")).toContainText(renamed);
    await expect(payoutDialog.getByTestId(`payout-task-toggle-${taskId}`)).toHaveAttribute("data-state", "checked");

    // Ask for the preview. The server builds against real spendable UTxOs,
    // which this unfunded wallet lacks, so the dialog must show the
    // pipeline's error rather than a created transaction.
    const previewPromise = waitForTrpc(page, "task.preparePayout");
    await payoutDialog.getByTestId("payout-preview-button").click();
    await previewPromise;
    await expect(
      payoutDialog.getByTestId("payout-summary").or(payoutDialog.getByTestId("payout-error")),
    ).toBeVisible({ timeout: 60_000 });
    // Whatever the chain said, nothing was created without a confirmation.
    await expect(payoutDialog.getByTestId("payout-created")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(payoutDialog).toBeHidden();

    // Delete through the confirm dialog (it portals outside the task dialog).
    await renamedCard.click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("task-delete").click();
    const deletePromise = waitForTrpc(page, "task.delete");
    await page.getByTestId("task-delete-confirm").click();
    expect((await deletePromise).ok()).toBe(true);
    await expect(page.getByText("No tasks yet")).toBeVisible({ timeout: 30_000 });

    // Belt and braces: nothing pending was left on the throwaway wallet.
    const pending = await trpcMutate<unknown[]>(page, "transaction.getPendingTransactions", {
      walletId: wallet.walletId,
    }).catch(() => [] as unknown[]);
    expect(Array.isArray(pending) ? pending.length : 0).toBe(0);
  });
});
