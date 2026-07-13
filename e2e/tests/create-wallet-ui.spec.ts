import { test, expect } from "../fixtures/authFixture";
import { loadContext } from "../helpers/contextLoader";
import type { Page } from "@playwright/test";

type WalletCreationMode = "legacy" | "sdk";

async function waitForTrpc(page: Page, procedure: string): Promise<void> {
  const response = await page.waitForResponse(
    (r) => r.url().includes(`/api/trpc/${procedure}`) && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  expect(
    response.ok(),
    `${procedure} failed ${response.status()}: ${await response.text().catch(() => "")}`,
  ).toBe(true);
}

async function saveSigner(
  page: Page,
  signer: {
    address?: string;
    name: string;
    stakeKey?: string;
    drepKey?: string;
    clearStakeKey?: boolean;
  },
): Promise<void> {
  if (signer.address !== undefined) {
    await page.getByLabel("Address").fill(signer.address);
  }
  await page.getByLabel(/Signer name/i).fill(signer.name);
  if (signer.stakeKey !== undefined) {
    await page.getByLabel(/Stake Key/i).fill(signer.stakeKey);
  }
  if (signer.drepKey !== undefined) {
    await page.getByLabel(/DRep Key/i).fill(signer.drepKey);
  }
  if (signer.clearStakeKey) {
    await page.getByLabel(/Stake Key/i).fill("");
    await page.getByLabel(/DRep Key/i).fill("");
  }

  const saveButton = page.getByRole("button", { name: /^Save$/ });
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  const updatePromise = waitForTrpc(page, "wallet.updateNewWallet");
  await saveButton.click();
  await updatePromise;
}

async function addSigner(
  page: Page,
  signer: {
    address: string;
    name: string;
    stakeKey?: string;
    drepKey?: string;
    clearStakeKey?: boolean;
  },
): Promise<void> {
  await page.getByRole("button", { name: /add signer/i }).click();
  await saveSigner(page, signer);
}

async function setThresholdToTwoOfThree(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit" }).last().click();
  await page.getByRole("radio", { name: "2" }).click();
  const updatePromise = waitForTrpc(page, "wallet.updateNewWallet");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await updatePromise;
  await expect(page.getByText("2 of 3 signers must approve")).toBeVisible();
}

async function createWalletThroughUi(
  page: Page,
  mode: WalletCreationMode,
): Promise<string> {
  const ctx = loadContext();
  const suffix = `${mode}-${Date.now()}-${test.info().workerIndex}`;
  const walletName = `E2E ${mode.toUpperCase()} ${suffix}`;
  const clearStakeKey = mode === "legacy";

  await page.goto("/wallets/new-wallet-flow/save");

  await page.getByLabel("Name", { exact: true }).fill(walletName);
  await page.getByLabel(/Description/i).fill(`Playwright ${mode} wallet creation coverage`);
  await page.getByLabel(/Your name/i).fill("Signer 1");

  const createDraftPromise = waitForTrpc(page, "wallet.createNewWallet");
  await page.getByRole("button", { name: /save & continue/i }).click();
  await createDraftPromise;
  await expect(page).toHaveURL(/\/wallets\/new-wallet-flow\/create\/[^/]+$/);

  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.locator("tbody tr").first().locator("button").first().click();
  await saveSigner(page, {
    name: "Signer 1",
    stakeKey: clearStakeKey ? undefined : ctx.signerStakeAddresses[0],
    clearStakeKey,
  });

  await addSigner(page, {
    address: ctx.signerAddresses[1]!,
    name: "Signer 2",
    stakeKey: clearStakeKey ? undefined : ctx.signerStakeAddresses[1],
    clearStakeKey,
  });
  await addSigner(page, {
    address: ctx.signerAddresses[2]!,
    name: "Signer 3",
    stakeKey: clearStakeKey ? undefined : ctx.signerStakeAddresses[2],
    clearStakeKey,
  });

  await expect(page.locator("tbody tr")).toHaveCount(3);

  await setThresholdToTwoOfThree(page);

  await page.getByRole("button", { name: /advanced/i }).click();
  await expect(page.getByRole("heading", { name: "Native Script" })).toBeVisible();
  await expect(page.getByText("Payment Script")).toBeVisible();

  const createWalletPromise = waitForTrpc(page, "wallet.createWallet");
  await page.getByRole("button", { name: /^Create$/ }).click();
  await createWalletPromise;
  await expect(page).toHaveURL(/\/wallets\/new-wallet-flow\/ready\/[^/]+$/);
  await expect(page.getByText("Wallet created successfully")).toBeVisible();

  const walletsNavigationPromise = page.waitForURL(/\/wallets$/, { timeout: 30_000 });
  await page.getByRole("button", { name: /view all wallets/i }).click();
  await walletsNavigationPromise;
  await expect(page.getByText(walletName)).toBeVisible({ timeout: 30_000 });

  return walletName;
}

test.describe("create wallet UI", () => {
  test.describe.configure({ mode: "serial" });

  test("creates a legacy 2-of-3 wallet from the browser", async ({
    page,
    authenticateAs,
  }) => {
    await authenticateAs(page, 0);
    await createWalletThroughUi(page, "legacy");
  });

  test("creates an SDK 2-of-3 wallet from the browser", async ({
    page,
    authenticateAs,
  }) => {
    await authenticateAs(page, 0);
    await createWalletThroughUi(page, "sdk");
  });
});
