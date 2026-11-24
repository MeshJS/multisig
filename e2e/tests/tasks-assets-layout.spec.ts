import { captureLayoutComparison } from "../helpers/layoutComparison";
import { expect, type Locator, type Page } from "@playwright/test";
import superjson from "superjson";
import { test } from "../fixtures/resourceFixture";
import { mockNavigationWallets } from "../helpers/navigationWallet";
import { loadContext } from "../helpers/contextLoader";
import { COLUMNS } from "../../src/components/pages/wallet/tasks/types";

const longName = "TreasuryRelease".repeat(12);
const unit = "a".repeat(56) + "546f6b656e";

async function contained(el: Locator) {
  await el.scrollIntoViewIfNeeded();
  expect(
    await el.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.left < -1 || r.right > innerWidth + 1) return false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const b = p.getBoundingClientRect();
        if (
          /(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX) &&
          (r.left < b.left - 1 || r.right > b.right + 1)
        )
          return false;
      }
      return true;
    }),
  ).toBe(true);
}

async function setup(page: Page, populated: boolean) {
  const address = loadContext().signerAddresses[0]!;
  const amount = populated
    ? [
        { unit: "lovelace", quantity: "600000000" },
        { unit, quantity: "999999999999999999" },
      ]
    : [];
  await page.route(
    /\/addresses\/[^/]+(?:\/|\/utxos)?(?:\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const payload = url.pathname.endsWith("/utxos")
        ? (populated && !url.searchParams.has("page")) ||
          (populated && url.searchParams.get("page") === "1")
          ? [
              {
                address: decodeURIComponent(
                  url.pathname.split("/addresses/")[1]!.split("/")[0]!,
                ),
                tx_hash: "3".repeat(64),
                output_index: 0,
                amount,
                data_hash: null,
                inline_datum: null,
                reference_script_hash: null,
              },
            ]
          : []
        : { amount };
      await route.fulfill({ json: payload });
    },
  );
  await page.route(`**/assets/${unit}`, (route) =>
    route.fulfill({
      json: {
        policy_id: "a".repeat(56),
        metadata: { name: longName, ticker: longName, decimals: 0 },
      },
    }),
  );
  const tasks = populated
    ? COLUMNS.filter((c) => c.status !== "InReview").map((c, i) => ({
        id: `layout-${c.status}`,
        title: `${c.label} ${longName}`,
        description: longName,
        status: c.status,
        position: 0,
        priority: "High",
        assigneeAddress: address,
        dueDate: new Date("2026-01-01"),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: address,
        recipients: [
          {
            id: `recipient-${i}`,
            address,
            unit,
            quantity: "999999999999999999",
          },
        ],
        payouts: [],
        payout: {
          state: "ready",
          transactionId: null,
          txHash: null,
          payable: c.status === "Done",
          blocker: null,
        },
      }))
    : [];
  if (populated)
    tasks.push({
      ...tasks[2]!,
      id: "layout-paid",
      title: "Paid task",
      payout: { ...tasks[2]!.payout, state: "paid", payable: false },
    });
  const reads = {
    "task.list": tasks,
    "contact.getAll": [],
    "proxy.getProxiesByUserOrWallet": [],
  };
  const wallet = await mockNavigationWallets(page, false, reads);
  // Mutations are intercepted before reaching the app server.
  await page.route("**/api/trpc/task.move*", async (route) => {
    const body = route.request().postDataJSON();
    const input = (body["0"] ?? body).json;
    const task = tasks.find((t) => t.id === input.id)!;
    task.status = input.status;
    await route.fulfill({
      json: [{ result: { data: superjson.serialize(task) } }],
    });
  });
  await page.route("**/api/trpc/task.preparePayout*", (route) =>
    route.fulfill({
      json: [
        {
          result: {
            data: superjson.serialize({
              draftToken: "fixture-only",
              expiresAt: new Date(Date.now() + 600000).toISOString(),
              warnings: [],
              tasks: [{ id: "layout-Done", title: longName }],
              summary: {
                recipients: [
                  {
                    address,
                    label: longName,
                    amounts: [{ display: `999999999999999999 ${longName}` }],
                  },
                ],
                fee: { display: "0.2 ADA" },
                change: [],
                inputs: { count: 1 },
                threshold: { required: 2, total: 3 },
                description: longName,
              },
            }),
          },
        },
      ],
    }),
  );
  return wallet;
}

for (const width of [375, 412, 768, 820, 1024, 1280, 1440, 1920]) {
  for (const populated of [false, true]) {
    test(`Tasks and Assets ${populated ? "populated" : "empty"} at ${width}px`, async ({
      page,
      authenticateAs,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await authenticateAs(page, 0);
      const wallet = await setup(page, populated);
      await page.goto(`/wallets/${wallet.walletId}/assets`);
      const assets = page.getByTestId("assets-content");
      await expect(
        assets.getByRole("button", { name: "Deposit Funds" }),
      ).toBeVisible();
      if (populated)
        await expect(assets.locator(`h3[title="${longName}"]`)).toBeVisible();
      await expect(
        assets.getByRole("button", { name: "New Transaction" }),
      ).toBeEnabled({ enabled: populated });
      for (const el of await assets.locator("button, h3, p").all())
        await contained(el);
      expect(
        await assets.evaluate((el) =>
          Math.abs(
            el.getBoundingClientRect().width -
              el.firstElementChild!.getBoundingClientRect().width,
          ),
        ),
      ).toBeLessThan(2);
      if (populated && [375, 820, 1440].includes(width))
        await captureLayoutComparison(
          page,
          info,
          "assets",
          "@media(min-width:768px){[data-testid=assets-content]{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important}} @media(min-width:1024px){[data-testid=assets-content]{grid-template-columns:repeat(3,minmax(0,1fr))!important}}",
        );
      await page.goto(`/wallets/${wallet.walletId}/tasks`);
      if (!populated) {
        await expect(page.getByText("No tasks yet")).toBeVisible();
        await expect(page.getByTestId("prepare-payout-button")).toBeDisabled();
        await contained(page.getByTestId("new-task-button"));
        return;
      }
      const board = page.getByTestId("task-board");
      await expect(board).toBeVisible();
      await expect(
        page
          .getByTestId("task-card-layout-Done")
          .getByTestId("payout-badge-ready"),
      ).toHaveText("Payout ready");
      const geometry = await board.evaluate((el) => ({
        width: el.clientWidth,
        columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
      }));
      expect(geometry.columns).toBe(
        geometry.width >= 1088 ? 4 : geometry.width >= 544 ? 2 : 1,
      );
      for (const el of await board
        .locator(
          '[data-testid^="task-column-"], [data-testid^="task-card-"], button, [data-testid^="task-totals-"]',
        )
        .all())
        await contained(el);
      await page.getByTestId("task-select-layout-Done").click();
      await expect(page.getByTestId("prepare-payout-button")).toHaveText(
        "Prepare payout (1)",
      );
      await contained(page.getByTestId("task-selection-clear"));
      await contained(page.getByTestId("show-paid-tasks"));
      await page.getByTestId("show-paid-tasks").click();
      await expect(page.getByTestId("task-card-layout-paid")).toBeVisible();
      const selectedCard = page.getByTestId("task-card-layout-Done");
      const boxes = await Promise.all(
        [
          selectedCard.getByRole("checkbox"),
          selectedCard.getByRole("button", { name: /^Done / }),
          selectedCard.getByTestId("task-menu-layout-Done"),
        ].map((el) => el.boundingBox()),
      );
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!,
            b = boxes[j]!;
          expect(
            a.x + a.width <= b.x + 1 ||
              b.x + b.width <= a.x + 1 ||
              a.y + a.height <= b.y + 1 ||
              b.y + b.height <= a.y + 1,
          ).toBe(true);
        }
      await page.getByTestId("task-menu-layout-Done").click();
      await contained(page.getByRole("menu"));
      await page.getByTestId("task-pay-layout-Done").click();
      await contained(page.getByTestId("payout-task-list"));
      await contained(page.getByTestId("payout-preview-button"));
      await page.getByTestId("payout-preview-button").click();
      await expect(page.getByTestId("payout-summary")).toBeVisible();
      for (const el of await page
        .getByTestId("payout-summary")
        .locator("span")
        .all())
        await contained(el);
      await contained(page.getByTestId("payout-confirm-button"));
      await page.keyboard.press("Escape");
      await page.getByTestId("task-menu-layout-Backlog").click();
      await page.getByTestId("task-move-layout-Backlog-InReview").click();
      await expect(page.getByTestId("task-column-InReview")).toContainText(
        `Backlog ${longName}`,
      );
      await page
        .getByTestId("task-card-layout-Backlog")
        .getByRole("button", { name: `Backlog ${longName}`, exact: true })
        .click();
      await expect(page.getByTestId("task-title-input")).toHaveValue(
        `Backlog ${longName}`,
      );
      await contained(page.getByTestId("task-title-input"));
      await contained(page.getByTestId("task-save"));
      if (width >= 768) {
        const table = page.getByTestId("task-dialog").locator("table");
        const scroller = table.locator("..");
        await contained(scroller);
        const lastControl = table.locator("button").last();
        await lastControl.focus();
        await contained(lastControl);
        await expect(lastControl).toBeFocused();
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("task-dialog")).toBeHidden();
      if ([375, 820, 1440, 1920].includes(width)) {
        await board.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await captureLayoutComparison(
          page,
          info,
          "tasks",
          "@media(min-width:768px){[data-testid=task-board]{grid-template-columns:repeat(4,minmax(0,1fr))!important}}",
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test("dragging preserves moves on the two-column board", async ({
  page,
  authenticateAs,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await authenticateAs(page, 0);
  const wallet = await setup(page, true);
  await page.goto(`/wallets/${wallet.walletId}/tasks`);
  const card = page.getByTestId("task-card-layout-Backlog");
  await card.scrollIntoViewIfNeeded();
  const target = page.getByTestId("task-column-InProgress");
  const a = (await card.boundingBox())!,
    b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 8);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + 65, { steps: 12 });
  await page.mouse.up();
  await expect(target.getByTestId("task-card-layout-Backlog")).toBeVisible();
});

test("loading Tasks keeps its header and actions contained", async ({
  page,
  authenticateAs,
}) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await authenticateAs(page, 0);
  const wallet = await setup(page, false);
  await page.goto(`/wallets/${wallet.walletId}/assets`);
  await expect(page.getByTestId("assets-content")).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("task.list")) await gate;
    await route.fallback();
  });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Tasks", exact: true })
    .click();
  await expect(page.getByText(/^Loading/).first()).toBeVisible();
  await contained(page.getByTestId("new-task-button"));
  await contained(page.getByTestId("prepare-payout-button"));
  release();
  await expect(page.getByText("No tasks yet")).toBeVisible();
});

test("Assets retains full card width while balances load", async ({
  page,
  authenticateAs,
}) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await authenticateAs(page, 0);
  const wallet = await setup(page, true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/addresses\/[^/]+(?:\/|\/utxos)?(?:\?.*)?$/,
    async (route) => {
      await gate;
      await route.fallback();
    },
  );
  await page.goto(`/wallets/${wallet.walletId}/assets`);
  const content = page.getByTestId("assets-content");
  await expect(
    content.getByRole("button", { name: "Deposit Funds" }),
  ).toBeVisible();
  const before = await content.boundingBox();
  await contained(content);
  release();
  await expect(content.locator(`h3[title="${longName}"]`)).toBeVisible();
  expect((await content.boundingBox())!.width).toBe(before!.width);
  await contained(content.getByRole("button", { name: "New Transaction" }));
});
