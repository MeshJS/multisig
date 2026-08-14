// Phase 3 item 7: DRep and governance UI.
//
// Proves governance actions can be initiated from the browser without
// touching the chain:
//   - the governance page loads for an eligible wallet: DRep info card,
//     DRep management actions gated on registration state, mocked proposal
//     list renders
//   - DRep register/update forms validate their required fields
//   - the ballot modal opens, creates a ballot through tRPC, and lists it
//
// Runs against throwaway 2-of-3 SDK wallets (CI signer stake keys) so any
// created row can never trip ring-transfer's clean-pending precondition.
// UTxOs, account state, DRep status, and the proposal list are all mocked.
//
// Not covered here: actually submitting a DRep registration certificate from
// the browser. That path canonicalizes the CIP-119 anchor with jsonld
// (URDNA2015), which calls `crypto.subtle` — the Web Crypto API is only
// exposed in a secure context, and the Docker app is served over plain
// http://webapp:3000, so `crypto.subtle` is undefined and the build throws
// "crypto.subtle not found". Staking certificate proposals do not hit jsonld,
// which is why staking-ui covers propose-to-pending and this spec does not.
// DRep certificate building/broadcast stays in route-chain coverage
// (scripts/ci drep-certificates).

import { test, expect } from "../fixtures/authFixture";
import type { Page } from "@playwright/test";
import { loadContext } from "../helpers/contextLoader";
import { createThrowawayWallet, trpcMutate } from "../helpers/apiHelpers";
import { mockWalletUtxos, mockGovernanceState, MOCK_PROPOSAL_TITLE } from "../helpers/phase3Mocks";

// DRepForm textareas in DOM order; the fields have no placeholders or testids.
const TEXTAREA_INDEX = { bio: 0, objectives: 1, motivations: 2, qualifications: 3 };

type CiDrepAnchorJson = {
  body?: {
    givenName?: unknown;
    objectives?: unknown;
    motivations?: unknown;
    qualifications?: unknown;
  };
};

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`CI_DREP_ANCHOR_JSON body.${fieldName} must be a non-empty string`);
}

function getCiDrepFormValues(): {
  givenName: string;
  objectives: string;
  motivations: string;
  qualifications: string;
} {
  const raw = process.env.CI_DREP_ANCHOR_JSON;
  if (!raw) {
    throw new Error("CI_DREP_ANCHOR_JSON must be set for governance-drep-ui.spec.ts");
  }

  let parsed: CiDrepAnchorJson;
  try {
    parsed = JSON.parse(raw) as CiDrepAnchorJson;
  } catch (error) {
    throw new Error(
      `CI_DREP_ANCHOR_JSON must be valid single-line JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const body = parsed.body;
  if (!body) {
    throw new Error("CI_DREP_ANCHOR_JSON must include a body object");
  }

  const givenName = requiredString(body.givenName, "givenName").replace(/\s+/g, "");
  if (!givenName) {
    throw new Error("CI_DREP_ANCHOR_JSON body.givenName must contain non-whitespace characters");
  }

  return {
    givenName,
    objectives: requiredString(body.objectives, "objectives"),
    motivations: requiredString(body.motivations, "motivations"),
    qualifications: requiredString(body.qualifications, "qualifications"),
  };
}

async function fillRequiredDrepFields(page: Page): Promise<void> {
  const drep = getCiDrepFormValues();
  await page.getByPlaceholder("name must be without spaces").fill(drep.givenName);
  await page.locator("textarea").nth(TEXTAREA_INDEX.objectives).fill(drep.objectives);
  await page.locator("textarea").nth(TEXTAREA_INDEX.motivations).fill(drep.motivations);
  await page
    .locator("textarea")
    .nth(TEXTAREA_INDEX.qualifications)
    .fill(drep.qualifications);
}

test.describe("governance and DRep UI", () => {
  test("governance page loads with DRep info, gated management actions, and proposals", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E gov-page ${Date.now()}-${test.info().workerIndex}`,
      { withStakeKeys: true },
    );
    await mockWalletUtxos(page);
    await mockGovernanceState(page);

    await page.goto(`/wallets/${wallet.walletId}/governance`);

    // DRep info card renders with a derived DRep ID.
    await expect(page.getByRole("heading", { name: "DRep Information" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("code", { hasText: /^drep/ })).toBeVisible({
      timeout: 30_000,
    });

    // Management actions are gated on registration state: the mocked DRep
    // status is "not registered", so only Register is actionable.
    await page.getByText("DRep Management").click();
    await expect(
      page.getByRole("button", { name: "Register DRep", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Update DRep", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /^Retire DRep/ }),
    ).toBeDisabled();

    // The mocked active-proposals list hydrates and renders.
    await expect(page.getByText(MOCK_PROPOSAL_TITLE).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test("ballot modal opens, creates a ballot, and lists it", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E gov-ballot ${Date.now()}-${test.info().workerIndex}`,
      { withStakeKeys: true },
    );
    await mockWalletUtxos(page);
    await mockGovernanceState(page);

    await page.goto(`/wallets/${wallet.walletId}/governance`);
    await expect(page.getByRole("heading", { name: "DRep Information" })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "Manage Ballots" }).click();
    await expect(
      page.getByRole("heading", { name: "Manage Ballots" }),
    ).toBeVisible();

    // The create input is revealed by the "New" toggle.
    await page.getByRole("button", { name: "New" }).click();

    const ballotName = `CI ballot ${Date.now()}`;
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("ballot.create") &&
        response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByPlaceholder("Enter ballot name...").fill(ballotName);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(
      createResponse.ok(),
      `ballot.create failed ${createResponse.status()}`,
    ).toBe(true);

    // Extract the created ballot id from the tRPC envelope for cleanup.
    type TrpcEnvelope = { result?: { data?: { json?: { id?: string } } } };
    const createBody = (await createResponse.json()) as
      | TrpcEnvelope
      | TrpcEnvelope[];
    const createItem = Array.isArray(createBody) ? createBody[0] : createBody;
    const ballotId = createItem?.result?.data?.json?.id;

    try {
      await expect(page.getByText(ballotName).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      if (ballotId) {
        await trpcMutate(page, "ballot.delete", { ballotId }).catch(() => {});
      }
    }
  });

  test("DRep register and update forms validate required fields", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E gov-validate ${Date.now()}-${test.info().workerIndex}`,
      { withStakeKeys: true },
    );
    await mockWalletUtxos(page);
    await mockGovernanceState(page);
    const drep = getCiDrepFormValues();

    // Register form: submit stays disabled until every required field is set.
    await page.goto(`/wallets/${wallet.walletId}/governance/register`);
    const registerButton = page.getByRole("button", {
      name: "Register DRep",
      exact: true,
    });
    await expect(registerButton).toBeVisible({ timeout: 60_000 });
    await expect(registerButton).toBeDisabled();

    await page.getByPlaceholder("name must be without spaces").fill(drep.givenName);
    await expect(registerButton).toBeDisabled();

    await page.locator("textarea").nth(TEXTAREA_INDEX.objectives).fill(drep.objectives);
    await page.locator("textarea").nth(TEXTAREA_INDEX.motivations).fill(drep.motivations);
    await expect(registerButton).toBeDisabled();

    await page
      .locator("textarea")
      .nth(TEXTAREA_INDEX.qualifications)
      .fill(drep.qualifications);
    await expect(registerButton).toBeEnabled();

    // Update form: same required-field gating with the update action.
    await page.goto(`/wallets/${wallet.walletId}/governance/update`);
    const updateButton = page.getByRole("button", {
      name: "Update DRep",
      exact: true,
    });
    await expect(updateButton).toBeVisible({ timeout: 60_000 });
    await expect(updateButton).toBeDisabled();
    await fillRequiredDrepFields(page);
    await expect(updateButton).toBeEnabled();
  });
});
