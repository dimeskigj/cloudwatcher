import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_CIDRS } from "../core/default-ranges";
import type { RuntimePush } from "../core/messages";
import { DEFAULT_SETTINGS, type IgnoreRule, type Settings } from "../core/model";
import { LocalRepository } from "../storage/local-repository";
import { SessionNavigationStore } from "../storage/session-navigation-store";
import type { BrowserAdapter } from "./browser-adapter";
import {
  BackgroundController,
  type BeforeRequestDetails,
  type ResponseStartedDetails,
} from "./controller";

class FakeAdapter implements BrowserAdapter {
  readonly sent: Array<{ tabId: number; message: RuntimePush }> = [];
  readonly tabUrls = new Map<number, string | undefined>();
  readonly backedTabs: number[] = [];
  readonly blankTabs: number[] = [];
  goBackError: unknown;

  async sendNotice(tabId: number, message: RuntimePush): Promise<void> {
    this.sent.push({ tabId, message });
  }

  async getTabUrl(tabId: number): Promise<string | undefined> {
    return this.tabUrls.get(tabId);
  }

  async goBack(tabId: number): Promise<void> {
    if (this.goBackError !== undefined) {
      throw this.goBackError;
    }

    this.backedTabs.push(tabId);
  }

  async replaceWithBlank(tabId: number): Promise<void> {
    this.blankTabs.push(tabId);
  }
}

interface Harness {
  adapter: FakeAdapter;
  controller: BackgroundController;
  navigationStore: SessionNavigationStore;
  repository: LocalRepository;
}

interface HarnessOptions {
  settings?: Settings;
  ignoreRules?: IgnoreRule[];
  ranges?: string[];
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const repository = new LocalRepository(fakeBrowser.storage.local);
  await repository.initialize();

  if (options.settings !== undefined) {
    await repository.updateSettings(options.settings);
  }
  for (const rule of options.ignoreRules ?? []) {
    await repository.addIgnoreRule(rule);
  }
  if (options.ranges !== undefined) {
    await repository.saveRanges(options.ranges);
  }

  const adapter = new FakeAdapter();
  const navigationStore = new SessionNavigationStore(fakeBrowser.storage.session);
  let nextNavigationId = 0;
  const controller = new BackgroundController(repository, navigationStore, adapter, {
    createNavigationId: () => `nav-${++nextNavigationId}`,
    now: () => "2026-08-19T12:00:00.000Z",
  });
  await controller.initialize();

  return { adapter, controller, navigationStore, repository };
}

function beforeRequest(overrides: Partial<BeforeRequestDetails> = {}): BeforeRequestDetails {
  return {
    requestId: "main-1",
    tabId: 8,
    type: "main_frame",
    url: "https://shop.example.com/",
    incognito: false,
    ...overrides,
  };
}

function responseStarted(overrides: Partial<ResponseStartedDetails> = {}): ResponseStartedDetails {
  return {
    requestId: "main-1",
    tabId: 8,
    type: "main_frame",
    url: "https://shop.example.com/",
    incognito: false,
    responseHeaders: [{ name: "cf-ray", value: "abc" }],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function blockConfiguration({
  controller,
  repository,
}: Pick<Harness, "controller" | "repository">) {
  const persistSettings = repository.updateSettings.bind(repository);
  const started = deferred<void>();
  const canFinish = deferred<void>();
  vi.spyOn(repository, "updateSettings").mockImplementationOnce(async (settings) => {
    started.resolve();
    await canFinish.promise;
    return persistSettings(settings);
  });
  const operation = controller.handleMessage(
    {
      type: "options/update-settings",
      settings: { directNoticeMode: "banner", contentNoticeMode: "banner" },
    },
    {},
  );
  await started.promise;
  return { operation, release: canFinish.resolve };
}

describe("BackgroundController detection flow", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("starts a navigation and records a direct response only once", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();

    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: [{ name: "cf-cache-status", value: "HIT" }] }),
    );

    expect(await navigationStore.get(8)).toMatchObject({
      requestId: "main-1",
      navigationId: "nav-1",
      direct: { match: { evidence: [{ kind: "header", signal: "cf-ray" }] } },
      counted: { direct: true, content: false },
    });
    expect(adapter.sent[0]).toMatchObject({
      tabId: 8,
      message: {
        type: "notice/update",
        navigationId: "nav-1",
        notice: { kind: "direct", mode: "overlay", siteHost: "shop.example.com" },
      },
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toEqual({
      directNavigations: 1,
      contentNavigations: 0,
      lastSeenAt: "2026-08-19T12:00:00.000Z",
    });
  });

  it.each([
    "sub_frame",
    "stylesheet",
    "script",
    "image",
    "font",
    "object",
    "xmlhttprequest",
    "ping",
    "csp_report",
    "media",
    "websocket",
    "webtransport",
    "webbundle",
    "other",
  ])("treats a tab-associated %s response as content", async (type) => {
    const { adapter, controller, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());

    await controller.handleResponseStarted(
      responseStarted({
        requestId: `resource-${type}`,
        type,
        url: type === "websocket" ? "wss://cdn.example.net/socket" : "https://cdn.example.net/a",
      }),
    );

    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({
      kind: "content",
      mode: "banner",
      siteHost: "shop.example.com",
      resourceHost: "cdn.example.net",
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toMatchObject({
      directNavigations: 0,
      contentNavigations: 1,
    });
  });

  it("counts repeated content matches once and lets a later direct match replace the banner", async () => {
    const { adapter, controller, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());

    await controller.handleResponseStarted(
      responseStarted({
        requestId: "asset-1",
        type: "script",
        url: "https://cdn.example.net/app.js",
      }),
    );
    await controller.handleResponseStarted(
      responseStarted({
        requestId: "asset-2",
        type: "image",
        url: "https://images.example.net/logo.png",
      }),
    );
    await controller.handleResponseStarted(responseStarted());

    expect(adapter.sent[0]?.message.notice).toMatchObject({
      kind: "content",
      resourceHost: "cdn.example.net",
    });
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({
      kind: "direct",
      mode: "overlay",
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toMatchObject({
      directNavigations: 1,
      contentNavigations: 1,
    });
  });

  it("preserves a navigation ID across same-request redirects and refreshes final-site ignoring", async () => {
    const { controller, navigationStore, repository } = await createHarness({
      ignoreRules: [{ scope: "site", value: "example.net" }],
    });
    await controller.handleBeforeRequest(
      beforeRequest({ url: "https://redirector.example/start" }),
    );

    await controller.handleBeforeRequest(
      beforeRequest({ url: "https://account.example.net/final" }),
    );
    await controller.handleResponseStarted(
      responseStarted({ url: "https://account.example.net/final" }),
    );

    expect(await navigationStore.get(8)).toMatchObject({
      navigationId: "nav-1",
      requestId: "main-1",
      topLevelUrl: "https://account.example.net/final",
      identity: { hostname: "account.example.net", siteKey: "example.net" },
      suppressedForNavigation: true,
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.net"]).toMatchObject({
      directNavigations: 1,
    });
  });

  it("replaces state for a new main-frame request even when the URL is unchanged", async () => {
    const { controller, navigationStore } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());

    await controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));

    expect(await navigationStore.get(8)).toMatchObject({
      requestId: "main-2",
      navigationId: "nav-2",
      counted: { direct: false, content: false },
    });
  });

  it("classifies with whichever response metadata is available and ignores an empty response", async () => {
    const { adapter, controller, repository } = await createHarness({
      ranges: ["203.0.113.0/24"],
    });
    await controller.handleBeforeRequest(beforeRequest());

    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: undefined, ip: undefined }),
    );
    expect(adapter.sent).toEqual([]);
    expect((await repository.getOptionsSnapshot()).summaries).toEqual({});

    await controller.handleResponseStarted(
      responseStarted({
        requestId: "asset-ip",
        type: "image",
        url: "https://assets.example.net/image.png",
        responseHeaders: undefined,
        ip: "203.0.113.7",
      }),
    );

    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({
      kind: "content",
      evidence: [{ kind: "ip", ip: "203.0.113.7", cidr: "203.0.113.0/24" }],
    });
  });

  it("keeps counting while both notice categories are off and the site is ignored", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness({
      settings: { directNoticeMode: "off", contentNoticeMode: "off" },
      ignoreRules: [{ scope: "site", value: "example.com" }],
    });
    await controller.handleBeforeRequest(beforeRequest());

    await controller.handleResponseStarted(
      responseStarted({
        requestId: "asset-1",
        type: "script",
        url: "https://cdn.example.net/app.js",
      }),
    );
    await controller.handleResponseStarted(responseStarted());

    expect(adapter.sent.map(({ message }) => message.notice)).toEqual([null, null]);
    expect(await navigationStore.get(8)).toMatchObject({
      suppressedForNavigation: true,
      eligible: { direct: false, content: false },
      counted: { direct: true, content: true },
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toMatchObject({
      directNavigations: 1,
      contentNavigations: 1,
    });
  });

  it("detects and notifies in private tabs without recording persistent activity", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();
    const recordDetection = vi.spyOn(repository, "recordDetection");
    await controller.handleBeforeRequest(beforeRequest({ incognito: true }));

    await controller.handleResponseStarted(responseStarted({ incognito: true }));

    expect(recordDetection).not.toHaveBeenCalled();
    expect((await repository.getOptionsSnapshot()).summaries).toEqual({});
    expect(await navigationStore.get(8)).toMatchObject({
      incognito: true,
      direct: expect.any(Object),
      counted: { direct: true, content: false },
    });
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct" });
  });

  it("keeps a failed summary uncounted, still sends the notice, and retries on a later match", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();
    await repository.recordDetection("example.com", "direct", "2026-08-19T11:00:00.000Z");
    const writeFailure = new Error("summary unavailable");
    const recordDetection = vi
      .spyOn(repository, "recordDetection")
      .mockRejectedValueOnce(writeFailure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await controller.handleBeforeRequest(beforeRequest());

    await controller.handleResponseStarted(responseStarted());

    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct" });
    expect(await navigationStore.get(8)).toMatchObject({
      direct: expect.any(Object),
      counted: { direct: false, content: false },
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toMatchObject({
      directNavigations: 1,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Cloudwatcher could not record a detection summary.",
      writeFailure,
    );

    await controller.handleResponseStarted(responseStarted());

    expect(recordDetection).toHaveBeenCalledTimes(2);
    expect(await navigationStore.get(8)).toMatchObject({
      counted: { direct: true, content: false },
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toMatchObject({
      directNavigations: 2,
    });
  });

  it("ignores unsupported, unassociated, and stale main-frame responses", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest({ url: "about:blank" }));
    await controller.handleBeforeRequest(beforeRequest({ tabId: -1 }));
    expect(await navigationStore.get(8)).toBeUndefined();

    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted({ requestId: "stale-main" }));
    await controller.handleResponseStarted(
      responseStarted({ tabId: -1, requestId: "asset", type: "script" }),
    );
    await controller.handleResponseStarted(
      responseStarted({ requestId: "asset", type: "script", url: "data:text/plain,hello" }),
    );

    expect(adapter.sent).toEqual([]);
    expect((await repository.getOptionsSnapshot()).summaries).toEqual({});
    const state = await navigationStore.get(8);
    expect(state).toMatchObject({ counted: { direct: false, content: false } });
    expect(state?.direct).toBeUndefined();
    expect(state?.content).toBeUndefined();
  });

  it("orders a blocked main-frame start before its response without blocking another tab", async () => {
    const harness = await createHarness();
    const { adapter, controller, navigationStore, repository } = harness;
    await controller.handleBeforeRequest(
      beforeRequest({ tabId: 9, requestId: "main-9", url: "https://page.example.net/" }),
    );
    const blocked = await blockConfiguration(harness);

    const starting = controller.handleBeforeRequest(beforeRequest());
    const responding = controller.handleResponseStarted(responseStarted());
    let independentFinished = false;
    const independent = controller
      .handleResponseStarted(
        responseStarted({
          tabId: 9,
          requestId: "asset-9",
          type: "image",
          url: "https://cdn.example.org/image.png",
        }),
      )
      .then(() => {
        independentFinished = true;
      });

    try {
      await vi.waitFor(() => expect(independentFinished).toBe(true), { timeout: 500 });
      expect(await navigationStore.get(9)).toMatchObject({ content: expect.any(Object) });
    } finally {
      blocked.release();
    }

    await Promise.all([blocked.operation, starting, responding, independent]);
    expect(await navigationStore.get(8)).toMatchObject({
      requestId: "main-1",
      direct: expect.any(Object),
    });
    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toMatchObject({
      directNavigations: 1,
    });
    expect(adapter.sent.some(({ tabId }) => tabId === 8)).toBe(true);
  });

  it("orders a blocked redirect before its main-frame response", async () => {
    const harness = await createHarness();
    const { controller, navigationStore, repository } = harness;
    await controller.handleBeforeRequest(
      beforeRequest({ url: "https://redirector.example/start" }),
    );
    const blocked = await blockConfiguration(harness);

    const redirecting = controller.handleBeforeRequest(
      beforeRequest({ url: "https://account.example.net/final" }),
    );
    const responding = controller.handleResponseStarted(
      responseStarted({ url: "https://account.example.net/final" }),
    );
    blocked.release();

    await Promise.all([blocked.operation, redirecting, responding]);
    expect(await navigationStore.get(8)).toMatchObject({
      topLevelUrl: "https://account.example.net/final",
      direct: expect.any(Object),
    });
    const summaries = (await repository.getOptionsSnapshot()).summaries;
    expect(summaries["example.net"]).toMatchObject({ directNavigations: 1 });
    expect(summaries["redirector.example"]).toBeUndefined();
  });

  it("attributes content to a blocked new navigation instead of the previous tab state", async () => {
    const harness = await createHarness();
    const { controller, navigationStore, repository } = harness;
    await controller.handleBeforeRequest(beforeRequest({ url: "https://old.example/" }));
    const blocked = await blockConfiguration(harness);

    const starting = controller.handleBeforeRequest(
      beforeRequest({ requestId: "main-2", url: "https://new.example/" }),
    );
    const responding = controller.handleResponseStarted(
      responseStarted({
        requestId: "asset-2",
        type: "script",
        url: "https://cdn.example.net/app.js",
      }),
    );
    blocked.release();

    await Promise.all([blocked.operation, starting, responding]);
    expect(await navigationStore.get(8)).toMatchObject({
      requestId: "main-2",
      identity: { hostname: "new.example" },
      content: { resourceHost: "cdn.example.net" },
    });
    const summaries = (await repository.getOptionsSnapshot()).summaries;
    expect(summaries["new.example"]).toMatchObject({ contentNavigations: 1 });
    expect(summaries["old.example"]).toBeUndefined();
  });
});

function sender(tabId = 8): { tab: { id: number } } {
  return { tab: { id: tabId } };
}

describe("BackgroundController messages and actions", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("protects handshakes by sender tab and exact top-level URL", async () => {
    const { controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());

    await expect(
      controller.handleMessage(
        { type: "content/handshake", url: "https://shop.example.com/" },
        sender(),
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        navigationId: "nav-1",
        notice: { navigationId: "nav-1", kind: "direct" },
      },
    });
    await expect(
      controller.handleMessage(
        { type: "content/handshake", url: "https://shop.example.com/other" },
        sender(),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { navigationId: null, notice: null },
    });
    await expect(
      controller.handleMessage({ type: "content/handshake", url: "https://shop.example.com/" }, {}),
    ).resolves.toMatchObject({ ok: false });
  });

  it("rejects a stale navigation ID after a same-URL reload", async () => {
    const { adapter, controller, navigationStore } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    await controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage({ type: "notice/continue", navigationId: "nav-1" }, sender()),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/navigation/i) });
    await expect(
      controller.handleMessage(
        { type: "content/handshake", url: "https://shop.example.com/" },
        sender(),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { navigationId: "nav-2", notice: null },
    });
    expect(await navigationStore.get(8)).toMatchObject({
      navigationId: "nav-2",
      dismissed: { direct: false, content: false },
    });
    expect(adapter.sent).toEqual([]);
  });

  it("waits for a blocked same-URL reload before completing a handshake", async () => {
    const harness = await createHarness();
    const { controller } = harness;
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    const blocked = await blockConfiguration(harness);

    const reloading = controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    const handshaking = controller.handleMessage(
      { type: "content/handshake", url: "https://shop.example.com/" },
      sender(),
    );
    blocked.release();

    await expect(Promise.all([blocked.operation, reloading, handshaking])).resolves.toEqual([
      { ok: true, data: { directNoticeMode: "banner", contentNoticeMode: "banner" } },
      undefined,
      { ok: true, data: { navigationId: "nav-2", notice: null } },
    ]);
  });

  it("waits for a blocked same-URL reload before reading popup state", async () => {
    const harness = await createHarness();
    const { adapter, controller } = harness;
    adapter.tabUrls.set(8, "https://shop.example.com/");
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    const blocked = await blockConfiguration(harness);

    const reloading = controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    const popup = controller.handleMessage({ type: "popup/get", tabId: 8 }, {});
    blocked.release();

    await Promise.all([blocked.operation, reloading]);
    await expect(popup).resolves.toMatchObject({
      ok: true,
      data: { status: "none", hostname: "shop.example.com", evidence: [] },
    });
  });

  it("makes an old Continue ID stale behind a blocked same-URL reload", async () => {
    const harness = await createHarness();
    const { adapter, controller, navigationStore } = harness;
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;
    const blocked = await blockConfiguration(harness);

    const reloading = controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    const continuing = controller.handleMessage(
      { type: "notice/continue", navigationId: "nav-1" },
      sender(),
    );
    blocked.release();

    await Promise.all([blocked.operation, reloading]);
    await expect(continuing).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/navigation/i),
    });
    expect(await navigationStore.get(8)).toMatchObject({
      navigationId: "nav-2",
      dismissed: { direct: false, content: false },
    });
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]?.message).toMatchObject({
      navigationId: "nav-1",
      notice: { mode: "banner" },
    });
  });

  it("makes an old Ignore ID stale behind a blocked same-URL reload", async () => {
    const harness = await createHarness();
    const { controller, navigationStore, repository } = harness;
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    const blocked = await blockConfiguration(harness);

    const reloading = controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    const ignoring = controller.handleMessage(
      {
        type: "notice/ignore",
        navigationId: "nav-1",
        rule: { scope: "site", value: "example.com" },
      },
      sender(),
    );
    blocked.release();

    await Promise.all([blocked.operation, reloading]);
    await expect(ignoring).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/navigation/i),
    });
    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([]);
    expect(await navigationStore.get(8)).toMatchObject({
      navigationId: "nav-2",
      suppressedForNavigation: false,
    });
  });

  it("makes an old Leave ID stale behind a blocked same-URL reload", async () => {
    const harness = await createHarness();
    const { adapter, controller } = harness;
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    const blocked = await blockConfiguration(harness);

    const reloading = controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    const leaving = controller.handleMessage(
      { type: "notice/leave", navigationId: "nav-1" },
      sender(),
    );
    blocked.release();

    await Promise.all([blocked.operation, reloading]);
    await expect(leaving).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/navigation/i),
    });
    expect(adapter.backedTabs).toEqual([]);
    expect(adapter.blankTabs).toEqual([]);
  });

  it("continues by dismissing the currently derived category for one navigation", async () => {
    const { adapter, controller, navigationStore } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(
      responseStarted({
        requestId: "asset-1",
        type: "script",
        url: "https://cdn.example.net/app.js",
      }),
    );

    await expect(
      controller.handleMessage({ type: "notice/continue", navigationId: "nav-1" }, sender()),
    ).resolves.toEqual({ ok: true, data: undefined });

    expect(await navigationStore.get(8)).toMatchObject({
      dismissed: { direct: false, content: true },
    });
    expect(adapter.sent.at(-1)?.message).toEqual({
      type: "notice/update",
      navigationId: "nav-1",
      notice: null,
    });

    await controller.handleResponseStarted(
      responseStarted({
        requestId: "asset-2",
        type: "image",
        url: "https://images.example.net/logo.png",
      }),
    );
    expect(adapter.sent.at(-1)?.message.notice).toBeNull();
  });

  it.each([
    {
      label: "Continue",
      request: { type: "notice/continue", navigationId: "nav-1" } as const,
    },
    {
      label: "Ignore",
      request: {
        type: "notice/ignore",
        navigationId: "nav-1",
        rule: { scope: "site", value: "example.com" },
      } as const,
    },
  ])("responds to $label without waiting for notice delivery", async ({ request }) => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;
    const sendStarted = deferred<void>();
    vi.spyOn(adapter, "sendNotice").mockImplementation(async (tabId, message) => {
      adapter.sent.push({ tabId, message });
      sendStarted.resolve();
      await new Promise<void>(() => undefined);
    });
    let response: unknown;

    void controller.handleMessage(request, sender()).then((result) => {
      response = result;
    });
    await sendStarted.promise;

    await vi.waitFor(() => expect(response).toEqual({ ok: true, data: undefined }), {
      timeout: 500,
    });
  });

  it.each([
    ["exact host", { scope: "host", value: "shop.example.com" }],
    ["whole site", { scope: "site", value: "example.com" }],
  ] as const)(
    "persists an offered %s ignore and immediately suppresses the navigation",
    async (_label, rule) => {
      const { adapter, controller, navigationStore, repository } = await createHarness();
      await controller.handleBeforeRequest(beforeRequest());
      await controller.handleResponseStarted(responseStarted());

      await expect(
        controller.handleMessage({ type: "notice/ignore", navigationId: "nav-1", rule }, sender()),
      ).resolves.toEqual({ ok: true, data: undefined });

      expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([rule]);
      expect(await navigationStore.get(8)).toMatchObject({ suppressedForNavigation: true });
      expect(adapter.sent.at(-1)?.message.notice).toBeNull();
    },
  );

  it("rejects an ignore rule that was not one of the current notice choices", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage(
        {
          type: "notice/ignore",
          navigationId: "nav-1",
          rule: { scope: "host", value: "other.example.com" },
        },
        sender(),
      ),
    ).resolves.toMatchObject({ ok: false });

    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([]);
    expect(await navigationStore.get(8)).toMatchObject({ suppressedForNavigation: false });
    expect(adapter.sent).toEqual([]);
  });

  it("rejects ignore when the navigation has no detection notice", async () => {
    const { adapter, controller, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());

    await expect(
      controller.handleMessage(
        {
          type: "notice/ignore",
          navigationId: "nav-1",
          rule: { scope: "host", value: "shop.example.com" },
        },
        sender(),
      ),
    ).resolves.toMatchObject({ ok: false });

    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([]);
    expect(adapter.sent).toEqual([]);
  });

  it("rejects ignore when the detected category is off", async () => {
    const { adapter, controller, repository } = await createHarness({
      settings: { directNoticeMode: "off", contentNoticeMode: "banner" },
    });
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage(
        {
          type: "notice/ignore",
          navigationId: "nav-1",
          rule: { scope: "site", value: "example.com" },
        },
        sender(),
      ),
    ).resolves.toMatchObject({ ok: false });

    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([]);
    expect(adapter.sent).toEqual([]);
  });

  it("rejects ignore when the navigation is already suppressed by a rule", async () => {
    const existingRule = { scope: "site", value: "example.com" } as const;
    const { adapter, controller, repository } = await createHarness({
      ignoreRules: [existingRule],
    });
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage(
        {
          type: "notice/ignore",
          navigationId: "nav-1",
          rule: { scope: "host", value: "shop.example.com" },
        },
        sender(),
      ),
    ).resolves.toMatchObject({ ok: false });

    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([existingRule]);
    expect(adapter.sent).toEqual([]);
  });

  it("rejects ignore after the active notice is dismissed", async () => {
    const { adapter, controller, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    await controller.handleMessage({ type: "notice/continue", navigationId: "nav-1" }, sender());
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage(
        {
          type: "notice/ignore",
          navigationId: "nav-1",
          rule: { scope: "site", value: "example.com" },
        },
        sender(),
      ),
    ).resolves.toMatchObject({ ok: false });

    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([]);
    expect(adapter.sent).toEqual([]);
  });

  it("keeps explicit suppression sticky when an ignore write and redirect overlap", async () => {
    const { controller, navigationStore, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    const persistRule = repository.addIgnoreRule.bind(repository);
    let markWriteStarted: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    let releaseWrite: () => void = () => undefined;
    const writeCanFinish = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    vi.spyOn(repository, "addIgnoreRule").mockImplementationOnce(async (rule) => {
      markWriteStarted();
      await writeCanFinish;
      return persistRule(rule);
    });

    const ignoring = controller.handleMessage(
      {
        type: "notice/ignore",
        navigationId: "nav-1",
        rule: { scope: "site", value: "example.com" },
      },
      sender(),
    );
    await writeStarted;
    const redirecting = controller.handleBeforeRequest(
      beforeRequest({ url: "https://account.example.net/final" }),
    );
    releaseWrite();

    await expect(Promise.all([ignoring, redirecting])).resolves.toEqual([
      { ok: true, data: undefined },
      undefined,
    ]);
    expect(await navigationStore.get(8)).toMatchObject({
      topLevelUrl: "https://account.example.net/final",
      explicitlySuppressed: true,
      suppressedForNavigation: true,
    });
  });

  it("retains the navigation rule snapshot when removal and redirect overlap", async () => {
    const rule = { scope: "site", value: "example.com" } as const;
    const { controller, navigationStore, repository } = await createHarness({
      ignoreRules: [rule],
    });
    await controller.handleBeforeRequest(beforeRequest());

    const removing = controller.handleMessage({ type: "options/remove-ignore", rule }, {});
    const redirecting = controller.handleBeforeRequest(
      beforeRequest({ url: "https://account.example.com/final" }),
    );

    await expect(Promise.all([removing, redirecting])).resolves.toEqual([
      { ok: true, data: [] },
      undefined,
    ]);
    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([]);
    expect(await navigationStore.get(8)).toMatchObject({
      topLevelUrl: "https://account.example.com/final",
      ignoreRuleSnapshot: [rule],
      explicitlySuppressed: false,
      suppressedForNavigation: true,
    });
  });

  it("persists an explicit ignore selected in a private tab without adding activity", async () => {
    const { controller, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest({ incognito: true }));
    await controller.handleResponseStarted(responseStarted({ incognito: true }));

    await expect(
      controller.handleMessage(
        {
          type: "notice/ignore",
          navigationId: "nav-1",
          rule: { scope: "site", value: "example.com" },
        },
        sender(),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });

    const snapshot = await repository.getOptionsSnapshot();
    expect(snapshot.ignoreRules).toEqual([{ scope: "site", value: "example.com" }]);
    expect(snapshot.summaries).toEqual({});
  });

  it("goes back for a current notice and falls back to about:blank on failure", async () => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());

    await expect(
      controller.handleMessage({ type: "notice/leave", navigationId: "nav-1" }, sender()),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(adapter.backedTabs).toEqual([8]);
    expect(adapter.blankTabs).toEqual([]);

    adapter.goBackError = new Error("no history");
    await expect(
      controller.handleMessage({ type: "notice/leave", navigationId: "nav-1" }, sender()),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(adapter.blankTabs).toEqual([8]);
  });

  it("does not navigate when a leave action has a stale navigation ID", async () => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());

    await expect(
      controller.handleMessage({ type: "notice/leave", navigationId: "stale" }, sender()),
    ).resolves.toMatchObject({ ok: false });
    expect(adapter.backedTabs).toEqual([]);
    expect(adapter.blankTabs).toEqual([]);
  });

  it("reports direct and ignored popup state without hiding evidence or the site summary", async () => {
    const { adapter, controller } = await createHarness({
      ignoreRules: [{ scope: "site", value: "example.com" }],
    });
    adapter.tabUrls.set(8, "https://shop.example.com/");
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());

    await expect(controller.handleMessage({ type: "popup/get", tabId: 8 }, {})).resolves.toEqual({
      ok: true,
      data: {
        status: "direct",
        ignored: true,
        hostname: "shop.example.com",
        evidence: [{ kind: "header", signal: "cf-ray" }],
        summary: {
          directNavigations: 1,
          contentNavigations: 0,
          lastSeenAt: "2026-08-19T12:00:00.000Z",
        },
      },
    });
  });

  it("reports content, supported-empty, and protected popup states", async () => {
    const { adapter, controller } = await createHarness({
      ignoreRules: [{ scope: "host", value: "ignored.example.net" }],
    });
    adapter.tabUrls.set(8, "https://page.example.org/");
    adapter.tabUrls.set(9, "https://ignored.example.net/");
    adapter.tabUrls.set(10, "about:preferences");
    adapter.tabUrls.set(11, undefined);
    await controller.handleBeforeRequest(
      beforeRequest({ tabId: 8, url: "https://page.example.org/" }),
    );
    await controller.handleResponseStarted(
      responseStarted({
        tabId: 8,
        requestId: "asset-1",
        type: "script",
        url: "https://cdn.example.net/app.js",
      }),
    );

    await expect(
      controller.handleMessage({ type: "popup/get", tabId: 8 }, {}),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: "content",
        ignored: false,
        hostname: "page.example.org",
        contentHost: "cdn.example.net",
        evidence: [{ kind: "header", signal: "cf-ray" }],
      },
    });
    await expect(controller.handleMessage({ type: "popup/get", tabId: 9 }, {})).resolves.toEqual({
      ok: true,
      data: {
        status: "none",
        ignored: true,
        hostname: "ignored.example.net",
        evidence: [],
      },
    });
    await expect(controller.handleMessage({ type: "popup/get", tabId: 10 }, {})).resolves.toEqual({
      ok: true,
      data: { status: "unavailable", ignored: false, evidence: [] },
    });
    await expect(controller.handleMessage({ type: "popup/get", tabId: 11 }, {})).resolves.toEqual({
      ok: true,
      data: { status: "unavailable", ignored: false, evidence: [] },
    });
  });

  it("does not report stale session detection for a different current tab URL", async () => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.tabUrls.set(8, "https://different.example.net/");

    await expect(controller.handleMessage({ type: "popup/get", tabId: 8 }, {})).resolves.toEqual({
      ok: true,
      data: {
        status: "none",
        ignored: false,
        hostname: "different.example.net",
        evidence: [],
      },
    });
  });

  it("returns the validated options snapshot through the runtime protocol", async () => {
    const { controller, repository } = await createHarness({
      settings: { directNoticeMode: "banner", contentNoticeMode: "off" },
      ranges: ["203.0.113.0/24"],
    });

    await expect(controller.handleMessage({ type: "options/get" }, {})).resolves.toEqual({
      ok: true,
      data: await repository.getOptionsSnapshot(),
    });
  });

  it("closes direct and content notices when disabled and rearms only on a new navigation", async () => {
    const { adapter, controller, navigationStore } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    await controller.handleBeforeRequest(
      beforeRequest({
        tabId: 9,
        requestId: "main-9",
        url: "https://content.example.net/",
      }),
    );
    await controller.handleResponseStarted(
      responseStarted({
        tabId: 9,
        requestId: "asset-9",
        type: "image",
        url: "https://cdn.example.org/image.png",
      }),
    );
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage(
        {
          type: "options/update-settings",
          settings: { directNoticeMode: "off", contentNoticeMode: "off" },
        },
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      data: { directNoticeMode: "off", contentNoticeMode: "off" },
    });

    expect(await navigationStore.get(8)).toMatchObject({ eligible: { direct: false } });
    expect(await navigationStore.get(9)).toMatchObject({ eligible: { content: false } });
    expect(adapter.sent).toHaveLength(2);
    expect(adapter.sent.every(({ message }) => message.notice === null)).toBe(true);
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage({ type: "options/update-settings", settings: DEFAULT_SETTINGS }, {}),
    ).resolves.toEqual({ ok: true, data: DEFAULT_SETTINGS });
    expect(await navigationStore.get(8)).toMatchObject({ eligible: { direct: false } });
    expect(await navigationStore.get(9)).toMatchObject({ eligible: { content: false } });
    expect(adapter.sent).toEqual([]);

    await controller.handleResponseStarted(responseStarted());
    expect(adapter.sent.at(-1)?.message.notice).toBeNull();
    await controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    await controller.handleResponseStarted(responseStarted({ requestId: "main-2" }));
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct", mode: "overlay" });
  });

  it("serializes concurrent direct presentation changes through their notice pushes", async () => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;
    const bannerSettings: Settings = {
      directNoticeMode: "banner",
      contentNoticeMode: "banner",
    };

    const banner = controller.handleMessage(
      { type: "options/update-settings", settings: bannerSettings },
      {},
    );
    const overlay = controller.handleMessage(
      { type: "options/update-settings", settings: DEFAULT_SETTINGS },
      {},
    );

    await expect(Promise.all([banner, overlay])).resolves.toEqual([
      { ok: true, data: bannerSettings },
      { ok: true, data: DEFAULT_SETTINGS },
    ]);
    expect(adapter.sent.map(({ message }) => message.notice?.mode)).toEqual(["banner", "overlay"]);
  });

  it.each([
    {
      label: "update",
      initialSettings: DEFAULT_SETTINGS,
      request: {
        type: "options/update-settings",
        settings: { directNoticeMode: "banner", contentNoticeMode: "banner" },
      } as const,
      expectedMode: "banner",
    },
    {
      label: "reset",
      initialSettings: { directNoticeMode: "banner", contentNoticeMode: "banner" } as const,
      request: { type: "options/reset-section", section: "settings" } as const,
      expectedMode: "overlay",
    },
  ])("sends each tab's settings $label before mutating the next tab", async (scenario) => {
    const { adapter, controller } = await createHarness({ settings: scenario.initialSettings });
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    await controller.handleBeforeRequest(
      beforeRequest({
        tabId: 9,
        requestId: "main-9",
        url: "https://other.example.com/",
      }),
    );
    await controller.handleResponseStarted(
      responseStarted({
        tabId: 9,
        requestId: "main-9",
        url: "https://other.example.com/",
      }),
    );
    adapter.sent.length = 0;
    const persistSession = fakeBrowser.storage.session.set.bind(fakeBrowser.storage.session);
    const secondMutationStarted = deferred<void>();
    const secondMutationCanFinish = deferred<void>();
    vi.spyOn(fakeBrowser.storage.session, "set").mockImplementationOnce(async (items) => {
      expect(Object.hasOwn(items, "navigation:8")).toBe(true);
      await persistSession(items);
    });
    vi.spyOn(fakeBrowser.storage.session, "set").mockImplementationOnce(async (items) => {
      expect(Object.hasOwn(items, "navigation:9")).toBe(true);
      secondMutationStarted.resolve();
      await secondMutationCanFinish.promise;
      await persistSession(items);
    });

    const operation = controller.handleMessage(scenario.request, {});
    await secondMutationStarted.promise;

    try {
      await vi.waitFor(
        () => {
          expect(adapter.sent).toHaveLength(1);
          expect(adapter.sent[0]).toMatchObject({
            tabId: 8,
            message: { notice: { mode: scenario.expectedMode } },
          });
        },
        { timeout: 500 },
      );
    } finally {
      secondMutationCanFinish.resolve();
      await operation;
    }
  });

  it.each([
    {
      label: "update",
      initialSettings: DEFAULT_SETTINGS,
      request: {
        type: "options/update-settings",
        settings: { directNoticeMode: "banner", contentNoticeMode: "banner" },
      } as const,
      expectedData: { directNoticeMode: "banner", contentNoticeMode: "banner" },
    },
    {
      label: "reset",
      initialSettings: { directNoticeMode: "banner", contentNoticeMode: "banner" } as const,
      request: { type: "options/reset-section", section: "settings" } as const,
      expectedData: DEFAULT_SETTINGS,
    },
  ])("responds to a settings $label without waiting for delivery", async (scenario) => {
    const { adapter, controller } = await createHarness({ settings: scenario.initialSettings });
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    const sendStarted = deferred<void>();
    vi.spyOn(adapter, "sendNotice").mockImplementation(async () => {
      sendStarted.resolve();
      await new Promise<void>(() => undefined);
    });

    const operation = controller.handleMessage(scenario.request, {});
    await sendStarted.promise;

    await expect(operation).resolves.toEqual({ ok: true, data: scenario.expectedData });
  });

  it("does not let a never-settling notice block same-tab navigation or settings state", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;
    const sendStarted = deferred<void>();
    vi.spyOn(adapter, "sendNotice").mockImplementation(async (tabId, message) => {
      adapter.sent.push({ tabId, message });
      sendStarted.resolve();
      await new Promise<void>(() => undefined);
    });
    const bannerSettings: Settings = {
      directNoticeMode: "banner",
      contentNoticeMode: "banner",
    };

    void controller.handleMessage(
      { type: "options/update-settings", settings: bannerSettings },
      {},
    );
    await sendStarted.promise;
    let navigationFinished = false;
    void controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" })).then(() => {
      navigationFinished = true;
    });
    void controller.handleMessage(
      { type: "options/update-settings", settings: DEFAULT_SETTINGS },
      {},
    );

    await vi.waitFor(
      async () => {
        expect(navigationFinished).toBe(true);
        expect((await navigationStore.get(8))?.requestId).toBe("main-2");
        expect((await repository.getOptionsSnapshot()).settings).toEqual(DEFAULT_SETTINGS);
      },
      { timeout: 500 },
    );
    expect(adapter.sent).toHaveLength(1);
  });

  it("keeps same-tab notice sends ordered while later settings transactions complete", async () => {
    const { adapter, controller, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;
    const firstSendStarted = deferred<void>();
    const firstSendCanFinish = deferred<void>();
    vi.spyOn(adapter, "sendNotice").mockImplementation(async (tabId, message) => {
      adapter.sent.push({ tabId, message });

      if (adapter.sent.length === 1) {
        firstSendStarted.resolve();
        await firstSendCanFinish.promise;
      }
    });
    const bannerSettings: Settings = {
      directNoticeMode: "banner",
      contentNoticeMode: "banner",
    };

    const banner = controller.handleMessage(
      { type: "options/update-settings", settings: bannerSettings },
      {},
    );
    await firstSendStarted.promise;
    const overlay = controller.handleMessage(
      { type: "options/update-settings", settings: DEFAULT_SETTINGS },
      {},
    );

    try {
      await vi.waitFor(
        async () =>
          expect((await repository.getOptionsSnapshot()).settings).toEqual(DEFAULT_SETTINGS),
        { timeout: 500 },
      );
      expect(adapter.sent.map(({ message }) => message.notice?.mode)).toEqual(["banner"]);
    } finally {
      firstSendCanFinish.resolve();
    }

    await Promise.all([banner, overlay]);
    await vi.waitFor(() =>
      expect(adapter.sent.map(({ message }) => message.notice?.mode)).toEqual([
        "banner",
        "overlay",
      ]),
    );
  });

  it("coalesces same-tab pending notices to the latest state", async () => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;
    const firstSendStarted = deferred<void>();
    const firstSendCanFinish = deferred<void>();
    vi.spyOn(adapter, "sendNotice").mockImplementation(async (tabId, message) => {
      adapter.sent.push({ tabId, message });

      if (adapter.sent.length === 1) {
        firstSendStarted.resolve();
        await firstSendCanFinish.promise;
      }
    });
    const bannerSettings: Settings = {
      directNoticeMode: "banner",
      contentNoticeMode: "banner",
    };

    await controller.handleMessage(
      { type: "options/update-settings", settings: bannerSettings },
      {},
    );
    await firstSendStarted.promise;
    await controller.handleMessage(
      { type: "options/update-settings", settings: DEFAULT_SETTINGS },
      {},
    );
    await controller.handleMessage(
      { type: "options/update-settings", settings: bannerSettings },
      {},
    );
    await controller.handleMessage(
      { type: "options/update-settings", settings: DEFAULT_SETTINGS },
      {},
    );
    expect(adapter.sent.map(({ message }) => message.notice?.mode)).toEqual(["banner"]);

    firstSendCanFinish.resolve();
    await vi.waitFor(() => expect(adapter.sent.length).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adapter.sent.map(({ message }) => message.notice?.mode)).toEqual(["banner", "overlay"]);
  });

  it("delivers the latest pending notice after an outbound rejection", async () => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    adapter.sent.length = 0;
    const firstSendStarted = deferred<void>();
    const firstSendCanFail = deferred<void>();
    vi.spyOn(adapter, "sendNotice").mockImplementation(async (tabId, message) => {
      adapter.sent.push({ tabId, message });

      if (adapter.sent.length === 1) {
        firstSendStarted.resolve();
        await firstSendCanFail.promise;
        throw new Error("receiver closed");
      }
    });
    const bannerSettings: Settings = {
      directNoticeMode: "banner",
      contentNoticeMode: "banner",
    };

    await controller.handleMessage(
      { type: "options/update-settings", settings: bannerSettings },
      {},
    );
    await firstSendStarted.promise;
    await controller.handleMessage(
      { type: "options/update-settings", settings: DEFAULT_SETTINGS },
      {},
    );
    firstSendCanFail.resolve();

    await vi.waitFor(() =>
      expect(adapter.sent.map(({ message }) => message.notice?.mode)).toEqual([
        "banner",
        "overlay",
      ]),
    );
  });

  it("detaches blocked outbound work when a tab ID is reused", async () => {
    const { adapter, controller } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    const oldSendStarted = deferred<void>();
    const oldSendCanFinish = deferred<void>();
    const newSendCanFinish = deferred<void>();
    let newSendStarted = false;
    vi.spyOn(adapter, "sendNotice").mockImplementation(async (tabId, message) => {
      adapter.sent.push({ tabId, message });

      if (message.navigationId === "nav-1" && adapter.sent.length === 1) {
        oldSendStarted.resolve();
        await oldSendCanFinish.promise;
      }

      if (message.navigationId === "nav-2" && message.notice !== null) {
        newSendStarted = true;
        await newSendCanFinish.promise;
      }
    });

    const oldResponse = controller.handleResponseStarted(responseStarted());
    await oldSendStarted.promise;
    await controller.handleMessage({ type: "notice/continue", navigationId: "nav-1" }, sender());
    await controller.handleTabRemoved(8);
    await controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    const newResponse = controller.handleResponseStarted(responseStarted({ requestId: "main-2" }));

    try {
      await vi.waitFor(
        () => {
          expect(newSendStarted).toBe(true);
          expect(adapter.sent.map(({ message }) => message.navigationId)).toEqual([
            "nav-1",
            "nav-2",
          ]);
        },
        { timeout: 500 },
      );
      await controller.handleMessage({ type: "notice/continue", navigationId: "nav-2" }, sender());
      oldSendCanFinish.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(adapter.sent.map(({ message }) => message.navigationId)).toEqual(["nav-1", "nav-2"]);

      newSendCanFinish.resolve();
      await vi.waitFor(() => expect(adapter.sent).toHaveLength(3));
    } finally {
      oldSendCanFinish.resolve();
      newSendCanFinish.resolve();
    }

    await Promise.all([oldResponse, newResponse]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(adapter.sent.map(({ message }) => message.navigationId)).toEqual([
      "nav-1",
      "nav-2",
      "nav-2",
    ]);
    expect(adapter.sent.at(-1)?.message.notice).toBeNull();
  });

  it("orders a delayed navigation start before disabling settings without rearming it", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();
    const persistSession = fakeBrowser.storage.session.set.bind(fakeBrowser.storage.session);
    let markNavigationWriteStarted: () => void = () => undefined;
    const navigationWriteStarted = new Promise<void>((resolve) => {
      markNavigationWriteStarted = resolve;
    });
    let releaseNavigationWrite: () => void = () => undefined;
    const navigationWriteCanFinish = new Promise<void>((resolve) => {
      releaseNavigationWrite = resolve;
    });
    let delayFirstNavigationWrite = true;
    const operationOrder: string[] = [];
    vi.spyOn(fakeBrowser.storage.session, "set").mockImplementation(async (items) => {
      if (delayFirstNavigationWrite && Object.hasOwn(items, "navigation:8")) {
        delayFirstNavigationWrite = false;
        markNavigationWriteStarted();
        await navigationWriteCanFinish;
        operationOrder.push("navigation-start");
      }

      await persistSession(items);
    });
    const persistSettings = repository.updateSettings.bind(repository);
    vi.spyOn(repository, "updateSettings").mockImplementation((settings) => {
      operationOrder.push("settings-off");
      return persistSettings(settings);
    });

    const starting = controller.handleBeforeRequest(beforeRequest());
    await navigationWriteStarted;
    const disabling = controller.handleMessage(
      {
        type: "options/update-settings",
        settings: { directNoticeMode: "off", contentNoticeMode: "banner" },
      },
      {},
    );
    await Promise.resolve();
    releaseNavigationWrite();

    await Promise.all([starting, disabling]);
    expect(operationOrder).toEqual(["navigation-start", "settings-off"]);
    expect(await navigationStore.get(8)).toMatchObject({ eligible: { direct: false } });

    await controller.handleMessage(
      { type: "options/update-settings", settings: DEFAULT_SETTINGS },
      {},
    );
    adapter.sent.length = 0;
    await controller.handleResponseStarted(responseStarted());

    expect(adapter.sent.at(-1)?.message.notice).toBeNull();
  });

  it("keeps a removed ignore effective until the next main-frame navigation", async () => {
    const { adapter, controller, navigationStore, repository } = await createHarness();
    const rule = { scope: "site", value: "example.com" } as const;
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());
    await controller.handleMessage(
      { type: "notice/ignore", navigationId: "nav-1", rule },
      sender(),
    );
    adapter.sent.length = 0;

    await expect(
      controller.handleMessage({ type: "options/remove-ignore", rule }, {}),
    ).resolves.toEqual({ ok: true, data: [] });
    expect((await repository.getOptionsSnapshot()).ignoreRules).toEqual([]);
    expect(await navigationStore.get(8)).toMatchObject({ suppressedForNavigation: true });
    expect(adapter.sent).toEqual([]);

    await controller.handleResponseStarted(responseStarted());
    expect(adapter.sent.at(-1)?.message.notice).toBeNull();
    await controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    await controller.handleResponseStarted(responseStarted({ requestId: "main-2" }));
    expect(await navigationStore.get(8)).toMatchObject({ suppressedForNavigation: false });
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct" });
  });

  it("validates range drafts atomically and replaces the active compiled cache", async () => {
    const { adapter, controller, repository } = await createHarness({ ranges: [] });
    await controller.handleBeforeRequest(beforeRequest());

    await expect(
      controller.handleMessage(
        { type: "options/save-ranges", draft: "203.0.113.9/24\nnot-a-cidr" },
        {},
      ),
    ).resolves.toMatchObject({
      ok: false,
      validationErrors: [{ line: 2, input: "not-a-cidr" }],
    });
    expect((await repository.getOptionsSnapshot()).ipRanges).toEqual([]);
    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: undefined, ip: "203.0.113.7" }),
    );
    expect(adapter.sent).toEqual([]);

    await expect(
      controller.handleMessage(
        { type: "options/save-ranges", draft: "203.0.113.9/24\n203.0.113.0/24" },
        {},
      ),
    ).resolves.toEqual({ ok: true, data: ["203.0.113.0/24"] });
    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: undefined, ip: "203.0.113.7" }),
    );
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({
      kind: "direct",
      evidence: [{ kind: "ip", ip: "203.0.113.7", cidr: "203.0.113.0/24" }],
    });

    await controller.handleMessage({ type: "options/save-ranges", draft: "198.51.100.0/24" }, {});
    await controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    adapter.sent.length = 0;
    await controller.handleResponseStarted(
      responseStarted({
        requestId: "main-2",
        responseHeaders: undefined,
        ip: "203.0.113.7",
      }),
    );
    expect(adapter.sent).toEqual([]);
    await controller.handleResponseStarted(
      responseStarted({
        requestId: "main-2",
        responseHeaders: undefined,
        ip: "198.51.100.8",
      }),
    );
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct" });
  });

  it("orders a range reset before a concurrently invoked range save", async () => {
    const { adapter, controller, repository } = await createHarness({
      ranges: ["198.51.100.0/24"],
    });

    const resetting = controller.handleMessage(
      { type: "options/reset-section", section: "ipRanges" },
      {},
    );
    const saving = controller.handleMessage(
      { type: "options/save-ranges", draft: "203.0.113.0/24" },
      {},
    );

    await expect(Promise.all([resetting, saving])).resolves.toEqual([
      { ok: true, data: [...DEFAULT_CIDRS] },
      { ok: true, data: ["203.0.113.0/24"] },
    ]);
    expect((await repository.getOptionsSnapshot()).ipRanges).toEqual(["203.0.113.0/24"]);
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: undefined, ip: "203.0.113.7" }),
    );
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct" });
  });

  it("orders a range save before a concurrently invoked range reset", async () => {
    const { adapter, controller, repository } = await createHarness({ ranges: [] });

    const saving = controller.handleMessage(
      { type: "options/save-ranges", draft: "203.0.113.0/24" },
      {},
    );
    const resetting = controller.handleMessage(
      { type: "options/reset-section", section: "ipRanges" },
      {},
    );

    await expect(Promise.all([saving, resetting])).resolves.toEqual([
      { ok: true, data: ["203.0.113.0/24"] },
      { ok: true, data: [...DEFAULT_CIDRS] },
    ]);
    expect((await repository.getOptionsSnapshot()).ipRanges).toEqual([...DEFAULT_CIDRS]);
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: undefined, ip: "203.0.113.7" }),
    );
    expect(adapter.sent).toEqual([]);
    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: undefined, ip: "104.16.4.3" }),
    );
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct" });
  });

  it("clears persisted activity without changing detection state", async () => {
    const { controller, navigationStore, repository } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(responseStarted());

    await expect(controller.handleMessage({ type: "options/clear-activity" }, {})).resolves.toEqual(
      { ok: true, data: {} },
    );
    expect((await repository.getOptionsSnapshot()).summaries).toEqual({});
    expect(await navigationStore.get(8)).toMatchObject({ direct: expect.any(Object) });
  });

  it("resets each storage section and refreshes future controller caches", async () => {
    const { adapter, controller, repository } = await createHarness({
      settings: { directNoticeMode: "off", contentNoticeMode: "off" },
      ignoreRules: [{ scope: "site", value: "example.com" }],
      ranges: [],
    });
    await repository.recordDetection("example.com", "content", "2026-08-19T11:00:00.000Z");

    await expect(
      controller.handleMessage({ type: "options/reset-section", section: "settings" }, {}),
    ).resolves.toEqual({ ok: true, data: DEFAULT_SETTINGS });
    await expect(
      controller.handleMessage({ type: "options/reset-section", section: "ignoreRules" }, {}),
    ).resolves.toEqual({ ok: true, data: [] });
    await expect(
      controller.handleMessage({ type: "options/reset-section", section: "ipRanges" }, {}),
    ).resolves.toEqual({ ok: true, data: [...DEFAULT_CIDRS] });
    await expect(
      controller.handleMessage({ type: "options/reset-section", section: "summaries" }, {}),
    ).resolves.toEqual({ ok: true, data: {} });

    const snapshot = await repository.getOptionsSnapshot();
    expect(snapshot).toMatchObject({
      settings: DEFAULT_SETTINGS,
      ignoreRules: [],
      ipRanges: [...DEFAULT_CIDRS],
      summaries: {},
    });
    await controller.handleBeforeRequest(beforeRequest());
    await controller.handleResponseStarted(
      responseStarted({ responseHeaders: undefined, ip: "104.16.4.3" }),
    );
    expect(adapter.sent.at(-1)?.message.notice).toMatchObject({ kind: "direct", mode: "overlay" });
  });

  it("removes session navigation state when its tab closes", async () => {
    const { controller, navigationStore } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());

    await controller.handleTabRemoved(8);

    await expect(navigationStore.get(8)).resolves.toBeUndefined();
  });

  it("removes a tab after a main-frame handler waiting on initialization", async () => {
    const repository = new LocalRepository(fakeBrowser.storage.local);
    await repository.initialize();
    let finishInitialization: () => void = () => undefined;
    const initializationCanFinish = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    vi.spyOn(repository, "initialize").mockReturnValue(initializationCanFinish);
    const navigationStore = new SessionNavigationStore(fakeBrowser.storage.session);
    const controller = new BackgroundController(repository, navigationStore, new FakeAdapter(), {
      createNavigationId: () => "nav-1",
    });

    const starting = controller.handleBeforeRequest(beforeRequest());
    const removing = controller.handleTabRemoved(8);
    finishInitialization();
    await Promise.all([starting, removing]);

    await expect(navigationStore.get(8)).resolves.toBeUndefined();
  });

  it("keeps removal final when an earlier main-frame start is blocked on configuration", async () => {
    const harness = await createHarness();
    const { controller, navigationStore } = harness;
    const blocked = await blockConfiguration(harness);

    const starting = controller.handleBeforeRequest(beforeRequest());
    const removing = controller.handleTabRemoved(8);
    blocked.release();

    await Promise.all([blocked.operation, starting, removing]);
    await expect(navigationStore.get(8)).resolves.toBeUndefined();
  });

  it("starts a new tab generation while removal for the reused ID is pending", async () => {
    const { adapter, controller, navigationStore } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    const removeSession = fakeBrowser.storage.session.remove.bind(fakeBrowser.storage.session);
    const removalStarted = deferred<void>();
    const removalCanFinish = deferred<void>();
    vi.spyOn(fakeBrowser.storage.session, "remove").mockImplementationOnce(async (keys) => {
      removalStarted.resolve();
      await removalCanFinish.promise;
      await removeSession(keys);
    });

    const removing = controller.handleTabRemoved(8);
    await removalStarted.promise;
    const starting = controller.handleBeforeRequest(beforeRequest({ requestId: "main-2" }));
    const responding = controller.handleResponseStarted(responseStarted({ requestId: "main-2" }));
    removalCanFinish.resolve();

    await Promise.all([removing, starting, responding]);
    expect(await navigationStore.get(8)).toMatchObject({
      requestId: "main-2",
      navigationId: "nav-2",
      direct: { match: { evidence: [{ kind: "header", signal: "cf-ray" }] } },
    });
    expect(adapter.sent.at(-1)?.message).toMatchObject({
      navigationId: "nav-2",
      notice: { kind: "direct" },
    });
  });

  it("ignores a late response when removal has no replacement main-frame start", async () => {
    const { adapter, controller, navigationStore } = await createHarness();
    await controller.handleBeforeRequest(beforeRequest());
    adapter.sent.length = 0;
    const removeSession = fakeBrowser.storage.session.remove.bind(fakeBrowser.storage.session);
    const removalStarted = deferred<void>();
    const removalCanFinish = deferred<void>();
    vi.spyOn(fakeBrowser.storage.session, "remove").mockImplementationOnce(async (keys) => {
      removalStarted.resolve();
      await removalCanFinish.promise;
      await removeSession(keys);
    });

    const removing = controller.handleTabRemoved(8);
    await removalStarted.promise;
    const responding = controller.handleResponseStarted(
      responseStarted({ requestId: "asset-late", type: "script" }),
    );
    removalCanFinish.resolve();

    await Promise.all([removing, responding]);
    await expect(navigationStore.get(8)).resolves.toBeUndefined();
    expect(adapter.sent).toEqual([]);
  });

  it("returns protocol errors for invalid tab IDs and unknown messages", async () => {
    const { controller } = await createHarness();

    await expect(
      controller.handleMessage({ type: "popup/get", tabId: -1 }, {}),
    ).resolves.toMatchObject({ ok: false });
    await expect(controller.handleMessage({ type: "unknown" } as never, {})).resolves.toMatchObject(
      { ok: false },
    );
  });
});

describe("browser adapter", () => {
  it("swallows content-message failures while keeping navigation operations testable", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("no receiver"));
    const get = vi.fn().mockResolvedValue({ url: "https://example.com/" });
    const goBack = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const module = (await import("./browser-adapter")) as unknown as {
      createBrowserAdapter: (facade: {
        tabs: {
          sendMessage: typeof sendMessage;
          get: typeof get;
          goBack: typeof goBack;
          update: typeof update;
        };
      }) => BrowserAdapter;
    };
    const adapter = module.createBrowserAdapter({
      tabs: { sendMessage, get, goBack, update },
    });
    const push: RuntimePush = {
      type: "notice/update",
      navigationId: "nav-1",
      notice: null,
    };

    await expect(adapter.sendNotice(8, push)).resolves.toBeUndefined();
    await expect(adapter.getTabUrl(8)).resolves.toBe("https://example.com/");
    await adapter.goBack(8);
    await adapter.replaceWithBlank(8);

    expect(sendMessage).toHaveBeenCalledWith(8, push);
    expect(get).toHaveBeenCalledWith(8);
    expect(goBack).toHaveBeenCalledWith(8);
    expect(update).toHaveBeenCalledWith(8, { url: "about:blank" });
  });

  it("maps an inaccessible tab lookup to an unavailable URL", async () => {
    const module = (await import("./browser-adapter")) as unknown as {
      createBrowserAdapter: (facade: {
        tabs: {
          sendMessage: ReturnType<typeof vi.fn>;
          get: ReturnType<typeof vi.fn>;
          goBack: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        };
      }) => BrowserAdapter;
    };
    const adapter = module.createBrowserAdapter({
      tabs: {
        sendMessage: vi.fn(),
        get: vi.fn().mockRejectedValue(new Error("protected tab")),
        goBack: vi.fn(),
        update: vi.fn(),
      },
    });

    await expect(adapter.getTabUrl(8)).resolves.toBeUndefined();
  });
});
