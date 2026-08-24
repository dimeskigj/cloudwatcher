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
    await expect(options.getByText("Loading settings")).toBeHidden();
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
  context: async (_fixtures, use) => {
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
  await options.getByLabel("Direct-site notice").selectOption("banner");
  await options.getByRole("button", { name: "Save warning settings" }).click();
  await expect(options.getByRole("button", { name: "Save warning settings" })).toBeEnabled();
  await options.close();

  const banner = await newFixturePage(context, baseURL, "/direct");
  await expectNotice(banner);
  await banner.getByRole("button", { name: "Fixture control" }).click();
  await expect(banner.locator("body")).toHaveAttribute("data-clicked", "true");
});

test("exact-host ignore suppresses subsequent notices while popup counts continue", async ({
  baseURL,
  context,
  extensionUrl,
}) => {
  const page = await newFixturePage(context, baseURL, "/direct");
  await expectNotice(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);

  await page.goto(`${baseURL}/direct`);
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);
  await page.goto(`${baseURL}/content`);
  await expect(page.locator("cloudwatcher-notice")).toHaveCount(0);

  const popup = await openPopup(context, extensionUrl);
  await expect(popup.getByRole("heading", { name: "Cloudflare content observed" })).toBeVisible();
  await expect(popup.getByText("CF-Cache-Status header")).toBeVisible();
  await expect(popup.getByLabel("Current site history").getByText(/^[1-9]\d*$/)).toHaveCount(2);
});

test("popup shows direct evidence and nonzero counts", async ({
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
