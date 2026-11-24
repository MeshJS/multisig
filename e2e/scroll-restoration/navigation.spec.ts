import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import ts from "typescript";

const controller = ts.transpileModule(
  fs.readFileSync("src/lib/main-scroll-restoration.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

type Options = {
  shallow?: boolean;
  scroll?: boolean;
  height?: number;
  missingMain?: boolean;
};
declare global {
  interface Window {
    scrollHarness: {
      navigate: (href: string, options?: Options) => void;
      render: (height?: number) => void;
      dispose: () => void;
      fail: () => void;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.route("http://scroll.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="margin:0"><nav style="height:80px;overflow:auto"><div style="height:800px">Sidebar</div></nav><div id="shell"></div></body></html>',
    }),
  );
  await page.goto("http://scroll.test/getting-started");
  // Match Pages Router event ordering, including a window-only reset and its
  // post-routeComplete hash scroll. The controller itself is unmodified code.
  await page.addScriptTag({
    type: "module",
    content: `${controller}
    const handlers = new Map();
    const events = {
      on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
      off(name, fn) { handlers.get(name)?.delete(fn); },
    };
    const emit = (name, ...args) => handlers.get(name)?.forEach(fn => fn(...args));
    let sequence = 0;
    const render = (height = 3000) => {
      document.getElementById('shell').innerHTML = '<main id="main-content" tabindex="-1" style="height:300px;overflow:auto"><div style="height:' + height + 'px"><div style="height:700px"></div><section id="documents">Documents</section><section id="developers-and-bots">Developers</section></div></main>';
    };
    const finish = (href, options = {}) => {
      if (options.missingMain) document.getElementById('shell').innerHTML = '';
      else if (options.height !== undefined) render(options.height);
      window.scrollTo(0, 0);
      emit('routeChangeComplete', href, { shallow: !!options.shallow });
      const hash = new URL(href, location.origin).hash.slice(1);
      if (hash && options.scroll !== false) document.getElementById(hash)?.scrollIntoView();
    };
    history.replaceState({key:'initial',options:{}}, '', location.href);
    render();
    const dispose = installMainScrollRestoration(events);
    const navigate = (href, options = {}) => {
      emit('routeChangeStart', href, { shallow: !!options.shallow });
      history.pushState({key: String(++sequence), options}, '', href);
      finish(href, options);
    };
    window.addEventListener('popstate', () => {
      const href = location.pathname + location.search + location.hash;
      emit('routeChangeStart', href, {shallow:false});
      finish(href);
    });
    window.scrollHarness = { navigate, render, dispose, fail() {
      emit('routeChangeStart', '/failed', {shallow:false});
      emit('routeChangeError', new Error('cancelled'), '/failed', {shallow:false});
    }};
  `,
  });
  await page.waitForFunction(() => !!window.scrollHarness);
});

const top = (page: Page) =>
  page.locator("#main-content").evaluate((el) => el.scrollTop);
const expectTop = (page: Page, value: number) =>
  expect.poll(() => top(page)).toBe(value);
const scrollTo = async (page: Page, value: number) => {
  await page.locator("#main-content").evaluate((el, y) => {
    el.scrollTop = y;
  }, value);
  await expectTop(page, value);
};
const navigate = (page: Page, href: string, options: Options = {}) =>
  page.evaluate(
    ({ href, options }) => window.scrollHarness.navigate(href, options),
    { href, options },
  );

test("new visits start at the top, including revisits; sidebar position is independent", async ({
  page,
}) => {
  await page.locator("nav").evaluate((el) => {
    el.scrollTop = 250;
  });
  await scrollTo(page, 600);
  await navigate(page, "/features");
  await expectTop(page, 0);
  await scrollTo(page, 400);
  await navigate(page, "/getting-started");
  await expectTop(page, 0);
  expect(await page.locator("nav").evaluate((el) => el.scrollTop)).toBe(250);
});

test("Back/Forward restores each history entry, even repeated URLs", async ({
  page,
}) => {
  await scrollTo(page, 600);
  await navigate(page, "/features");
  await expectTop(page, 0);
  await scrollTo(page, 400);
  await navigate(page, "/getting-started");
  await expectTop(page, 0);
  await scrollTo(page, 200);
  await page.goBack();
  await expectTop(page, 400);
  await page.goBack();
  await expectTop(page, 600);
  await page.goForward();
  await expectTop(page, 400);
  await page.goForward();
  await expectTop(page, 200);
});

test("section links land on the section but Back restores a later reading position", async ({
  page,
}) => {
  await navigate(page, "/about#developers-and-bots");
  await expect.poll(() => top(page)).toBeGreaterThanOrEqual(700);
  await scrollTo(page, 1100);
  await navigate(page, "/features");
  await expectTop(page, 0);
  await page.goBack();
  await expectTop(page, 1100);
});

test("filters, shallow routing, and scroll:false preserve position", async ({
  page,
}) => {
  await scrollTo(page, 600);
  await navigate(page, "/getting-started?tab=documents");
  await expectTop(page, 600);
  await navigate(page, "/getting-started?tab=signers", { shallow: true });
  await expectTop(page, 600);
  await navigate(page, "/features", { scroll: false });
  await expectTop(page, 600);
});

test("wallet runtime can replace or delay the scroll container", async ({
  page,
}) => {
  await scrollTo(page, 600);
  // Let the scroll event update the snapshot before a same-route remount.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => window.scrollHarness.render());
  await expectTop(page, 600);
  await navigate(page, "/wallets/import-wallet", { missingMain: true });
  await page.evaluate(() => window.scrollHarness.render());
  await expectTop(page, 0);
  await navigate(page, "/getting-started#documents", { missingMain: true });
  await page.evaluate(() => window.scrollHarness.render());
  await expectTop(page, 700);
});

test("saved offsets wait for async content to grow", async ({ page }) => {
  await scrollTo(page, 1800);
  await navigate(page, "/features");
  await expectTop(page, 0);
  await page.evaluate(() => window.scrollHarness.render(800));
  await page.goBack();
  await expectTop(page, 500);
  await page.locator("main > div").evaluate((el) => {
    (el as HTMLElement).style.height = "3000px";
  });
  await expectTop(page, 1800);
});

test("user interaction cancels delayed restoration", async ({ page }) => {
  await scrollTo(page, 1800);
  await navigate(page, "/features");
  await expectTop(page, 0);
  await page.evaluate(() => window.scrollHarness.render(800));
  await page.goBack();
  await expectTop(page, 500);
  await page.locator("main").dispatchEvent("wheel");
  await scrollTo(page, 200);
  await page.locator("main > div").evaluate((el) => {
    (el as HTMLElement).style.height = "3000px";
  });
  await expectTop(page, 200);
});

test("failed routes preserve position and cleanup removes handlers", async ({
  page,
}) => {
  await scrollTo(page, 600);
  await page.evaluate(() => window.scrollHarness.fail());
  await expectTop(page, 600);
  await navigate(page, "/features");
  await expectTop(page, 0);
  await page.evaluate(() => window.scrollHarness.dispose());
  await scrollTo(page, 400);
  await navigate(page, "/about");
  await expectTop(page, 400);
});
