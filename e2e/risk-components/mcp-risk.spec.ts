import { test, expect } from "@playwright/test";
import { REVIEW_CARD_HTML } from "../../src/lib/mcp/apps/review-card";
import { assessTransactionRisks } from "../../src/lib/tx-risk/transaction";
import { summarizeMeshBody } from "../../src/lib/tx-review/summary";
import {
  address,
  funding,
  output,
  transaction,
  HUGE_QUANTITY,
  TOKEN,
} from "../../src/__tests__/fixtures/tx-risk";

test("MCP inline review shows exact CBOR risks on mobile before unsigned proposal confirmation", async ({
  page,
}) => {
  const txHex = transaction({
    outputs: [
      output(address("known", 1), "5000000", true),
      output(address("known", 1), "7000000"),
    ],
  });
  const risk = assessTransactionRisks(
    txHex,
    { network: 1 },
    {
      utxos: [
        {
          ...funding,
          output: { ...funding.output, address: address("key", 1) },
        },
      ],
    },
  );
  const summary = summarizeMeshBody(
    {
      outputs: risk.outputs.map((o) => ({
        address: o.address,
        amount: o.assets,
      })),
    },
    {
      kind: "preview",
      wallet: {
        id: "wallet",
        name: "Treasury",
        address: address("key", 1),
        network: 1,
      },
      threshold: { required: 2, total: 3, type: "atLeast" },
      signedAddresses: [],
      rejectedAddresses: [],
      description: "<img src=x onerror=alert(1)>",
      assetMetadata: {},
      labelAddress: () => ({ label: "Trusted contact", type: "contact" }),
      txHash: risk.txHash!,
      riskAssessment: risk,
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    '<iframe style="width:100%;height:2400px;border:0" title="MCP review"></iframe>',
  );
  await page.evaluate((html) => {
    (window as any).calls = [];
    window.addEventListener("message", (event) => {
      const message = event.data;
      const frame = document.querySelector("iframe")!.contentWindow!;
      if (message.method === "ui/initialize")
        frame.postMessage(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: { hostContext: { theme: "light" } },
          },
          "*",
        );
      if (message.method === "tools/call") {
        (window as any).calls.push(message.params);
        frame.postMessage(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              structuredContent: {
                transactionId: "pending",
                summary: { kind: "pending" },
              },
            },
          },
          "*",
        );
      }
    });
    document.querySelector("iframe")!.srcdoc = html;
  }, REVIEW_CARD_HTML);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#root")).toBeVisible();
  await page.evaluate((value) => {
    document.querySelector("iframe")!.contentWindow!.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          structuredContent: {
            summary: value,
            draftToken: "bound-preview-token",
          },
          // The structured risk card remains readable even in image delivery mode.
          content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
        },
      },
      "*",
    );
  }, summary);
  await expect(frame.locator("#root")).toContainText(
    "Mainnet: real ADA and tokens are at risk.",
  );
  await expect(frame.locator("#root")).toContainText(TOKEN);
  await expect(frame.locator("#root")).toContainText(HUGE_QUANTITY);
  await expect(frame.locator("#root")).toContainText("Output 2");
  await expect(frame.locator("#root")).toContainText(
    "Each signer independently reviews",
  );
  await expect(frame.locator("img")).toHaveCount(0);
  expect(
    await frame
      .locator("#root")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
  await frame
    .getByRole("button", { name: "Confirm and create for signers" })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(1);
  expect(await page.evaluate(() => (window as any).calls[0])).toEqual({
    name: "transaction_propose",
    arguments: { draftToken: "bound-preview-token" },
  });
});
