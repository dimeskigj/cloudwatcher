import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, test as base, chromium, expect, type Page } from "@playwright/test";

const extensionPath = resolve(".output/chrome-mv3");

async function extensionIdFor(context: BrowserContext): Promise<string> {
  const worker =
    context
      .serviceWorkers()
      .find((candidate) => candidate.url().startsWith("chrome-extension://")) ??
    (await context.waitForEvent("serviceworker", {
      predicate: (candidate) => candidate.url().startsWith("chrome-extension://"),
    }));
  return new URL(worker.url()).host;
}

async function waitForExtensionReady(context: BrowserContext): Promise<void> {
  const extensionId = await extensionIdFor(context);
  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByRole("heading", { name: "Warnings" })).toBeVisible();
    await expect(options.getByRole("heading", { name: "Settings unavailable" })).toHaveCount(0);
    await expect(options.getByRole("alert")).toHaveCount(0);
  } finally {
    await options.close();
  }
}

interface ExtensionFixture {
  context: BrowserContext;
  extensionId: string;
  extensionUrl: (path: "popup.html" | "options.html") => string;
}

const test = base.extend<ExtensionFixture>({
  context: async ({ browserName: _browserName }, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cloudwatcher-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    try {
      await waitForExtensionReady(context);
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },
  extensionId: async ({ context }, use) => {
    await use(await extensionIdFor(context));
  },
  extensionUrl: async ({ extensionId }, use) => {
    await use((path) => `chrome-extension://${extensionId}/${path}`);
  },
});

async function newFixturePage(
  context: BrowserContext,
  baseURL: string | undefined,
  path: string,
): Promise<Page> {
  if (baseURL === undefined) {
    throw new Error("Playwright baseURL is required for fixture navigation.");
  }
  const page = await context.newPage();
  await page.goto(`${baseURL}${path}`);
  return page;
}

async function expectNotice(page: Page): Promise<void> {
  const notice = page.locator("cloudwatcher-notice");
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveJSProperty("offsetWidth", await page.evaluate(() => innerWidth));
  await expect(notice).toHaveJSProperty("offsetHeight", await page.evaluate(() => innerHeight));
}

async function continueNotice(page: Page): Promise<void> {
  await expectNotice(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);
}

function observeSaveCycle(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const save = document.querySelector("button.options__primary");
        if (save === null) {
          throw new Error("Save warning settings button was unavailable.");
        }
        let sawBusy = false;
        const observer = new MutationObserver((records) => {
          if (
            records.some((record) => record.type === "attributes" && record.oldValue === "true") ||
            save.getAttribute("aria-busy") === "true"
          ) {
            sawBusy = true;
          }
          if (sawBusy && save.getAttribute("aria-busy") === "false") {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(save, {
          attributes: true,
          attributeFilter: ["aria-busy"],
          attributeOldValue: true,
        });
      }),
  );
}

function waitForNextRender(page: Page): Promise<void> {
  return page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

async function openPopup(
  context: BrowserContext,
  extensionUrl: (path: "popup.html" | "options.html") => string,
): Promise<Page> {
  const popupUrl = extensionUrl("popup.html");
  const popupPromise = context.waitForEvent("page", {
    predicate: (page) => page.url() === popupUrl,
  });
  const worker = context
    .serviceWorkers()
    .find((candidate) => candidate.url().includes(new URL(popupUrl).host));
  if (worker === undefined) {
    throw new Error("Cloudwatcher extension worker was unavailable while opening the popup.");
  }
  await worker.evaluate(
    (url) =>
      (
        globalThis as unknown as {
          chrome: {
            tabs: { create: (properties: { url: string; active: boolean }) => Promise<unknown> };
          };
        }
      ).chrome.tabs.create({ url, active: false }),
    popupUrl,
  );
  const popup = await popupPromise;
  await popup.waitForLoadState();
  return popup;
}

test("plain pages have no Cloudwatcher notice", async ({ baseURL, context, extensionId }) => {
  expect(extensionId).not.toHaveLength(0);
  const page = await newFixturePage(context, baseURL, "/plain");
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);
});

test("absent loading text alone cannot prove options readiness", async ({ baseURL, context }) => {
  const page = await newFixturePage(context, baseURL, "/plain");
  await expect(page.getByText("Loading settings")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Warnings" })).toHaveCount(0);
});

test("direct notices overlay, continue once, and return on reload", async ({
  baseURL,
  context,
}) => {
  const page = await newFixturePage(context, baseURL, "/direct");
  await continueNotice(page);
  await page.reload();
  await expectNotice(page);
});

test("content notices are nonblocking while the fixture control remains clickable", async ({
  baseURL,
  context,
}) => {
  const page = await newFixturePage(context, baseURL, "/content");
  await expectNotice(page);
  await page.getByRole("button", { name: "Fixture control" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-clicked", "true");
});

test("options change direct notices to a nonblocking banner for the next navigation", async ({
  baseURL,
  context,
  extensionUrl,
}) => {
  const direct = await newFixturePage(context, baseURL, "/direct");
  await continueNotice(direct);

  const options = await context.newPage();
  await options.goto(extensionUrl("options.html"));
  const directNoticeMode = options.getByLabel("Direct-site notice");
  await directNoticeMode.focus();
  await options.keyboard.press("ArrowDown");
  await expect(directNoticeMode).toHaveValue("banner");
  const save = options.locator("button.options__primary");
  const saveCycle = observeSaveCycle(options);
  await save.click();
  await saveCycle;
  await expect(save).toHaveAttribute("aria-busy", "false");
  await expect(save).toHaveText("Save warning settings");
  await options.reload();
  await expect(options.getByLabel("Direct-site notice")).toHaveValue("banner");
  await options.close();

  const banner = await newFixturePage(context, baseURL, "/direct");
  await expectNotice(banner);
  await expect(banner.getByRole("button", { name: "Fixture control" })).toBeVisible();
});

test("exact-host ignore suppresses subsequent notices while popup counts continue", async ({
  baseURL,
  context,
  extensionUrl,
}) => {
  const page = await newFixturePage(context, baseURL, "/direct");
  await expectNotice(page);
  const beforeIgnore = await openPopup(context, extensionUrl);
  await expect(beforeIgnore.getByLabel("Current site history").locator("dd")).toHaveText([
    "1",
    "0",
  ]);
  await beforeIgnore.close();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitForNextRender(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);

  await page.goto(`${baseURL}/direct`);
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);
  await page.goto(`${baseURL}/content`);
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);

  const popup = await openPopup(context, extensionUrl);
  await expect(popup.getByRole("heading", { name: "Cloudflare content observed" })).toBeVisible();
  await expect(popup.getByText("CF-Cache-Status header")).toBeVisible();
  await expect(popup.getByLabel("Current site history").locator("dd")).toHaveText(["2", "1"]);
});

test("popup-page rendering shows direct evidence and nonzero counts", async ({
  baseURL,
  context,
  extensionUrl,
}) => {
  const page = await newFixturePage(context, baseURL, "/direct");
  await continueNotice(page);

  const popup = await openPopup(context, extensionUrl);
  await expect(popup.getByRole("heading", { name: "Site uses Cloudflare" })).toBeVisible();
  await expect(popup.getByText("CF-Ray header")).toBeVisible();
  await expect(popup.getByLabel("Current site history").getByText(/^[1-9]\d*$/)).toHaveCount(1);
});
