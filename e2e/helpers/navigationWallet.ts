import type { Page } from "@playwright/test";
import superjson from "superjson";
import { loadContext, getWallet } from "./contextLoader";
import { buildTwoOfThreeScript } from "./apiHelpers";

export const WALLET_NAME = "Navigation fixture wallet";

// Only wallet reads are fixtures; session authentication and the app's providers
// remain real. Saved bootstrap wallet IDs may no longer exist in the local DB.
export async function mockNavigationWallets(page: Page, empty = false, reads: Record<string, unknown> = {}, walletName = WALLET_NAME) {
  const context = loadContext();
  const wallet = getWallet(context, "legacy");
  const { scriptCbor } = await buildTwoOfThreeScript(context.signerAddresses);
  const record = {
    id: wallet.walletId,
    name: walletName,
    description: "Navigation test fixture",
    type: "atLeast",
    numRequiredSigners: 2,
    scriptCbor,
    signersAddresses: context.signerAddresses,
    signersDescriptions: [],
    signersStakeKeys: [],
    signersDRepKeys: [],
    verified: [],
    isArchived: false,
    ownerAddress: context.signerAddresses[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await page.route("**/api/trpc/**", async (route) => {
    const names = new URL(route.request().url()).pathname
      .split("/api/trpc/")[1]!
      .split(",");
    if (
      !names.some(
        (name) =>
          name === "wallet.getWallet" || name === "wallet.getUserWallets" || name in reads,
      )
    )
      return route.fallback();
    const response = await route.fetch();
    const original = await response.json();
    const payload = Array.isArray(original) ? original : [original];
    names.forEach((name, index) => {
      if (name === "wallet.getWallet" || name === "wallet.getUserWallets" || name in reads) {
        payload[index] = {
          result: {
            data: superjson.serialize(
              name in reads ? reads[name] : name === "wallet.getWallet" ? record : empty ? [] : [record],
            ),
          },
        };
      }
    });
    await route.fulfill({
      response,
      status: 200,
      json: Array.isArray(original) ? payload : payload[0],
    });
  });
  return wallet;
}
