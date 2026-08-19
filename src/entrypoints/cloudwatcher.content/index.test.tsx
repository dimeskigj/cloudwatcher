import { afterEach, describe, expect, it, vi } from "vitest";
import type { HandshakeData, RuntimeResponse } from "../../core/messages";
import type { NoticeState } from "../../core/model";

const entrypoint = vi.hoisted(() => {
  const defineContentScript = vi.fn((definition: unknown) => definition);
  const addListener = vi.fn();
  const removeListener = vi.fn();
  const sendMessage = vi.fn();
  const browser = {
    runtime: {
      onMessage: { addListener, removeListener },
      sendMessage,
    },
  };

  return { addListener, browser, defineContentScript, removeListener, sendMessage };
});

vi.mock("wxt/browser", () => ({ browser: entrypoint.browser }));
vi.mock("wxt/utils/define-content-script", () => ({
  defineContentScript: entrypoint.defineContentScript,
}));
vi.mock("#imports", () => ({
  browser: entrypoint.browser,
  defineContentScript: entrypoint.defineContentScript,
}));

import contentScript, {
  createClosedNoticeHost,
  createNoticeRuntime,
  type NoticeRuntimeDependencies,
  type NoticeRuntimeHost,
} from "./index";
import type { NoticeAction } from "./Notice";

const directNotice: NoticeState = {
  navigationId: "nav-current",
  kind: "direct",
  mode: "overlay",
  siteHost: "shop.example.com",
  evidence: [{ kind: "header", signal: "cf-ray" }],
  ignoreChoices: [
    {
      label: "shop.example.com only",
      rule: { scope: "host", value: "shop.example.com" },
    },
    {
      label: "example.com and all subdomains",
      rule: { scope: "site", value: "example.com" },
    },
  ],
};

const contentNotice: NoticeState = {
  ...directNotice,
  kind: "content",
  mode: "banner",
  resourceHost: "cdn.example.net",
};

function success(data: HandshakeData): RuntimeResponse<HandshakeData> {
  return { ok: true, data };
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface RuntimeHarness {
  createHost: ReturnType<typeof vi.fn<() => NoticeRuntimeHost>>;
  get listener(): ((message: unknown) => void) | undefined;
  removeHost: ReturnType<typeof vi.fn<(host: NoticeRuntimeHost) => void>>;
  renderNotice: ReturnType<typeof vi.fn<NoticeRuntimeDependencies["renderNotice"]>>;
  restoreFocus: ReturnType<typeof vi.fn<(target: Element) => void>>;
  runtime: ReturnType<typeof createNoticeRuntime>;
  sendMessage: ReturnType<typeof vi.fn<NoticeRuntimeDependencies["sendMessage"]>>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createHarness(
  handshake: Promise<RuntimeResponse<HandshakeData>>,
  actionResponse: () => RuntimeResponse<unknown> = () => ({ ok: true, data: undefined }),
): RuntimeHarness {
  let listener: ((message: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((next: (message: unknown) => void) => {
    listener = next;
    return unsubscribe;
  });
  const sendMessage = vi.fn<NoticeRuntimeDependencies["sendMessage"]>((request) => {
    if (request.type === "content/handshake") {
      return handshake;
    }
    return Promise.resolve(actionResponse());
  });
  const createHost = vi.fn<() => NoticeRuntimeHost>(() => {
    const host = document.createElement("cloudwatcher-notice");
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    root.append(mount);
    return { host, root, mount };
  });
  const renderNotice = vi.fn<NoticeRuntimeDependencies["renderNotice"]>();
  const removeHost = vi.fn<(host: NoticeRuntimeHost) => void>(({ host }) => host.remove());
  const restoreFocus = vi.fn<(target: Element) => void>((target) => {
    if (target instanceof HTMLElement) {
      target.focus();
    }
  });
  const runtime = createNoticeRuntime({
    url: "https://shop.example.com/private?token=secret",
    sendMessage,
    subscribe,
    createHost,
    renderNotice,
    removeHost,
    getActiveElement: () => document.activeElement,
    restoreFocus,
  });

  return {
    createHost,
    get listener() {
      return listener;
    },
    removeHost,
    renderNotice,
    restoreFocus,
    runtime,
    sendMessage,
    unsubscribe,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  for (const host of document.querySelectorAll("cloudwatcher-notice")) {
    host.remove();
  }
  vi.clearAllMocks();
});

describe("content script definition", () => {
  it("runs once in the isolated top frame at document_start on HTTP and HTTPS pages", () => {
    expect(contentScript).toMatchObject({
      matches: ["http://*/*", "https://*/*"],
      allFrames: false,
      runAt: "document_start",
      world: "ISOLATED",
      main: expect.any(Function),
    });
  });

  it("manually creates one host with an inaccessible closed root, style, and mount node", () => {
    const created = createClosedNoticeHost(document, ":host { position: fixed; }");

    expect(created.host.localName).toBe("cloudwatcher-notice");
    expect(created.host.parentElement).toBe(document.documentElement);
    expect(created.host.shadowRoot).toBeNull();
    expect(created.root.mode).toBe("closed");
    expect(created.root.querySelector("style")).toHaveTextContent(":host { position: fixed; }");
    expect(created.root.lastElementChild).toBe(created.mount);
  });
});

describe("createNoticeRuntime", () => {
  it("renders nothing before a successful handshake and then ignores stale navigation updates", async () => {
    const handshake = deferred<RuntimeResponse<HandshakeData>>();
    const harness = createHarness(handshake.promise);

    const starting = harness.runtime.start();
    expect(harness.sendMessage).toHaveBeenCalledWith({
      type: "content/handshake",
      url: "https://shop.example.com/private?token=secret",
    });
    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: contentNotice,
    });
    expect(harness.createHost).not.toHaveBeenCalled();
    expect(harness.renderNotice).not.toHaveBeenCalled();

    handshake.resolve(success({ navigationId: "nav-current", notice: directNotice }));
    await starting;

    expect(harness.createHost).toHaveBeenCalledOnce();
    expect(harness.renderNotice).toHaveBeenCalledOnce();
    expect(harness.renderNotice).toHaveBeenLastCalledWith(
      expect.any(Object),
      directNotice,
      expect.any(Function),
    );

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-stale",
      notice: null,
    });
    expect(harness.removeHost).not.toHaveBeenCalled();

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: contentNotice,
    });
    expect(harness.createHost).toHaveBeenCalledOnce();
    expect(harness.renderNotice).toHaveBeenCalledTimes(2);
    expect(harness.renderNotice).toHaveBeenLastCalledWith(
      expect.any(Object),
      contentNotice,
      expect.any(Function),
    );
  });

  it("does not accept updates after a failed or navigation-less handshake", async () => {
    const failed = createHarness(Promise.resolve({ ok: false, error: "not ready" }));
    await failed.runtime.start();
    failed.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: directNotice,
    });
    expect(failed.renderNotice).not.toHaveBeenCalled();

    const noNavigation = createHarness(
      Promise.resolve(success({ navigationId: null, notice: null })),
    );
    await noNavigation.runtime.start();
    noNavigation.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: directNotice,
    });
    expect(noNavigation.renderNotice).not.toHaveBeenCalled();
  });

  it("removes a null notice and restores focus captured before an overlay", async () => {
    const pageButton = document.createElement("button");
    pageButton.textContent = "Page control";
    document.body.append(pageButton);
    pageButton.focus();
    const harness = createHarness(
      Promise.resolve(success({ navigationId: "nav-current", notice: directNotice })),
    );
    harness.renderNotice.mockImplementation(({ mount }) => {
      const innerButton = document.createElement("button");
      mount.replaceChildren(innerButton);
      innerButton.focus();
    });

    await harness.runtime.start();
    expect(pageButton).not.toHaveFocus();

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: null,
    });

    expect(harness.removeHost).toHaveBeenCalledOnce();
    expect(harness.restoreFocus).toHaveBeenCalledWith(pageButton);
    expect(pageButton).toHaveFocus();
  });

  it("maps every component action to the existing runtime protocol and rejects failed responses", async () => {
    let response: RuntimeResponse<unknown> = { ok: true, data: undefined };
    const harness = createHarness(
      Promise.resolve(success({ navigationId: "nav-current", notice: directNotice })),
      () => response,
    );
    await harness.runtime.start();
    const onAction = harness.renderNotice.mock.calls[0]?.[2];
    expect(onAction).toBeTypeOf("function");

    const actions: NoticeAction[] = [
      { type: "continue" },
      { type: "leave" },
      { type: "ignore", rule: { scope: "host", value: "shop.example.com" } },
      { type: "ignore", rule: { scope: "site", value: "example.com" } },
    ];
    for (const action of actions) {
      await onAction?.(action);
    }

    expect(harness.sendMessage.mock.calls.slice(1).map(([request]) => request)).toEqual([
      { type: "notice/continue", navigationId: "nav-current" },
      { type: "notice/leave", navigationId: "nav-current" },
      {
        type: "notice/ignore",
        navigationId: "nav-current",
        rule: { scope: "host", value: "shop.example.com" },
      },
      {
        type: "notice/ignore",
        navigationId: "nav-current",
        rule: { scope: "site", value: "example.com" },
      },
    ]);

    response = { ok: false, error: "choice was not saved" };
    await expect(onAction?.({ type: "continue" })).rejects.toThrow("choice was not saved");
  });

  it("unsubscribes, unmounts, restores overlay focus, and ignores late handshake work on stop", async () => {
    const pageButton = document.createElement("button");
    document.body.append(pageButton);
    pageButton.focus();
    const active = createHarness(
      Promise.resolve(success({ navigationId: "nav-current", notice: directNotice })),
    );
    await active.runtime.start();

    active.runtime.stop();
    active.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: contentNotice,
    });

    expect(active.unsubscribe).toHaveBeenCalledOnce();
    expect(active.removeHost).toHaveBeenCalledOnce();
    expect(active.restoreFocus).toHaveBeenCalledWith(pageButton);
    expect(active.renderNotice).toHaveBeenCalledOnce();

    const handshake = deferred<RuntimeResponse<HandshakeData>>();
    const stoppedEarly = createHarness(handshake.promise);
    const starting = stoppedEarly.runtime.start();
    stoppedEarly.runtime.stop();
    handshake.resolve(success({ navigationId: "nav-current", notice: directNotice }));
    await starting;

    expect(stoppedEarly.unsubscribe).toHaveBeenCalledOnce();
    expect(stoppedEarly.createHost).not.toHaveBeenCalled();
    expect(stoppedEarly.renderNotice).not.toHaveBeenCalled();
  });
});
