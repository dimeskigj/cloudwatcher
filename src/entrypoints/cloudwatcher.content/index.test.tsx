import { waitFor } from "@testing-library/preact";
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
  registrableDomain: "example.com",
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

const directBannerNotice: NoticeState = {
  ...directNotice,
  mode: "banner",
};

const canonicalHostNotices: Array<{ label: string; notice: NoticeState }> = [
  {
    label: "localhost",
    notice: {
      ...directNotice,
      siteHost: "localhost",
      registrableDomain: undefined,
      ignoreChoices: [{ label: "localhost only", rule: { scope: "host", value: "localhost" } }],
    },
  },
  {
    label: "IPv4",
    notice: {
      ...directNotice,
      siteHost: "203.0.113.7",
      registrableDomain: undefined,
      ignoreChoices: [{ label: "203.0.113.7 only", rule: { scope: "host", value: "203.0.113.7" } }],
    },
  },
  {
    label: "IPv6",
    notice: {
      ...directNotice,
      siteHost: "2001:db8::1",
      registrableDomain: undefined,
      ignoreChoices: [{ label: "2001:db8::1 only", rule: { scope: "host", value: "2001:db8::1" } }],
    },
  },
  {
    label: "apex domain",
    notice: {
      ...directNotice,
      siteHost: "example.com",
      registrableDomain: "example.com",
      ignoreChoices: [
        { label: "example.com only", rule: { scope: "host", value: "example.com" } },
        {
          label: "example.com and all subdomains",
          rule: { scope: "site", value: "example.com" },
        },
      ],
    },
  },
  {
    label: "private-suffix apex",
    notice: {
      ...directNotice,
      siteHost: "team.github.io",
      registrableDomain: "team.github.io",
      ignoreChoices: [
        { label: "team.github.io only", rule: { scope: "host", value: "team.github.io" } },
        {
          label: "team.github.io and all subdomains",
          rule: { scope: "site", value: "team.github.io" },
        },
      ],
    },
  },
];

function sparseArray(): unknown[] {
  const values: unknown[] = [];
  values.length = 1;
  return values;
}

const malformedNotices: Array<{ label: string; notice: unknown }> = [
  { label: "missing fields", notice: {} },
  { label: "unknown kind", notice: { ...directNotice, kind: "future" } },
  { label: "unknown mode", notice: { ...directNotice, mode: "toast" } },
  {
    label: "content overlay combination",
    notice: { ...contentNotice, mode: "overlay" },
  },
  {
    label: "content without a resource host",
    notice: { ...contentNotice, resourceHost: undefined },
  },
  { label: "empty navigation ID", notice: { ...directNotice, navigationId: "" } },
  { label: "empty site host", notice: { ...directNotice, siteHost: "" } },
  {
    label: "URL-shaped site host",
    notice: { ...directNotice, siteHost: "https://shop.example.com/private" },
  },
  {
    label: "non-canonical site host",
    notice: { ...directNotice, siteHost: "SHOP.EXAMPLE.COM." },
  },
  { label: "non-string resource host", notice: { ...contentNotice, resourceHost: 7 } },
  {
    label: "path-shaped resource host",
    notice: { ...contentNotice, resourceHost: "cdn.example.net/private" },
  },
  { label: "non-array evidence", notice: { ...directNotice, evidence: {} } },
  { label: "sparse evidence", notice: { ...directNotice, evidence: sparseArray() } },
  {
    label: "unknown header evidence",
    notice: { ...directNotice, evidence: [{ kind: "header", signal: "cf-future" }] },
  },
  {
    label: "incomplete IP evidence",
    notice: { ...directNotice, evidence: [{ kind: "ip", ip: "203.0.113.7" }] },
  },
  { label: "non-array ignore choices", notice: { ...directNotice, ignoreChoices: {} } },
  { label: "empty ignore choices", notice: { ...directNotice, ignoreChoices: [] } },
  {
    label: "sparse ignore choices",
    notice: { ...directNotice, ignoreChoices: sparseArray() },
  },
  {
    label: "non-string ignore label",
    notice: {
      ...directNotice,
      ignoreChoices: [{ label: 7, rule: { scope: "host", value: "shop.example.com" } }],
    },
  },
  {
    label: "unknown ignore scope",
    notice: {
      ...directNotice,
      ignoreChoices: [
        { label: "shop.example.com only", rule: { scope: "domain", value: "example.com" } },
      ],
    },
  },
  {
    label: "empty ignore value",
    notice: {
      ...directNotice,
      ignoreChoices: [{ label: "shop.example.com only", rule: { scope: "host", value: "" } }],
    },
  },
  {
    label: "path-shaped ignore value",
    notice: {
      ...directNotice,
      ignoreChoices: [
        {
          label: "shop.example.com/private only",
          rule: { scope: "host", value: "shop.example.com/private" },
        },
      ],
    },
  },
  {
    label: "misleading ignore label",
    notice: {
      ...directNotice,
      ignoreChoices: [
        { label: "example.com only", rule: { scope: "host", value: "shop.example.com" } },
      ],
    },
  },
  {
    label: "ignore rule for another host",
    notice: {
      ...directNotice,
      ignoreChoices: [
        { label: "other.example.com only", rule: { scope: "host", value: "other.example.com" } },
      ],
    },
  },
  {
    label: "site-only ignore choices",
    notice: {
      ...directNotice,
      ignoreChoices: [
        {
          label: "example.com and all subdomains",
          rule: { scope: "site", value: "example.com" },
        },
      ],
    },
  },
  {
    label: "missing expected site choice",
    notice: {
      ...directNotice,
      ignoreChoices: [
        { label: "shop.example.com only", rule: { scope: "host", value: "shop.example.com" } },
      ],
    },
  },
  {
    label: "duplicate ignore choice",
    notice: {
      ...directNotice,
      ignoreChoices: [
        ...directNotice.ignoreChoices,
        { label: "shop.example.com only", rule: { scope: "host", value: "shop.example.com" } },
      ],
    },
  },
  {
    label: "site choice without a registrable-domain field",
    notice: { ...directNotice, registrableDomain: undefined },
  },
  {
    label: "mismatched registrable-domain field",
    notice: { ...directNotice, registrableDomain: "other.example.com" },
  },
  {
    label: "localhost site choice",
    notice: {
      ...directNotice,
      siteHost: "localhost",
      registrableDomain: "localhost",
      ignoreChoices: [
        { label: "localhost only", rule: { scope: "host", value: "localhost" } },
        {
          label: "localhost and all subdomains",
          rule: { scope: "site", value: "localhost" },
        },
      ],
    },
  },
  {
    label: "IPv4 site choice",
    notice: {
      ...directNotice,
      siteHost: "203.0.113.7",
      registrableDomain: "203.0.113.7",
      ignoreChoices: [
        { label: "203.0.113.7 only", rule: { scope: "host", value: "203.0.113.7" } },
        {
          label: "203.0.113.7 and all subdomains",
          rule: { scope: "site", value: "203.0.113.7" },
        },
      ],
    },
  },
  {
    label: "IPv6 site choice",
    notice: {
      ...directNotice,
      siteHost: "2001:db8::1",
      registrableDomain: "2001:db8::1",
      ignoreChoices: [
        { label: "2001:db8::1 only", rule: { scope: "host", value: "2001:db8::1" } },
        {
          label: "2001:db8::1 and all subdomains",
          rule: { scope: "site", value: "2001:db8::1" },
        },
      ],
    },
  },
];

const malformedHandshakeData: Array<{ label: string; data: unknown }> = [
  { label: "missing handshake fields", data: {} },
  { label: "numeric handshake navigation ID", data: { navigationId: 7, notice: null } },
  { label: "empty handshake navigation ID", data: { navigationId: "", notice: null } },
  {
    label: "notice paired with a null navigation ID",
    data: { navigationId: null, notice: directNotice },
  },
  {
    label: "mismatched inner navigation ID",
    data: {
      navigationId: "nav-current",
      notice: { ...directNotice, navigationId: "nav-other" },
    },
  },
  ...malformedNotices.map(({ label, notice }) => ({
    label: `${label} in handshake`,
    data: { navigationId: "nav-current", notice },
  })),
];

const malformedPushes: Array<{ label: string; message: unknown }> = [
  { label: "null message", message: null },
  { label: "missing push fields", message: {} },
  {
    label: "throwing record",
    message: new Proxy(
      {},
      {
        get() {
          throw new Error("malformed message getter");
        },
      },
    ),
  },
  {
    label: "numeric outer navigation ID",
    message: { type: "notice/update", navigationId: 7, notice: directNotice },
  },
  ...malformedNotices.map(({ label, notice }) => ({
    label: `${label} in push`,
    message: { type: "notice/update", navigationId: "nav-current", notice },
  })),
];

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
  activateOverlay: ReturnType<typeof vi.fn<(host: NoticeRuntimeHost) => () => void>>;
  createHost: ReturnType<typeof vi.fn<() => NoticeRuntimeHost>>;
  deactivateOverlay: ReturnType<typeof vi.fn>;
  get listener(): ((message: unknown) => void) | undefined;
  removeHost: ReturnType<typeof vi.fn<(host: NoticeRuntimeHost) => void>>;
  renderNotice: ReturnType<typeof vi.fn<NoticeRuntimeDependencies["renderNotice"]>>;
  restoreFocus: ReturnType<typeof vi.fn<(target: Element) => void>>;
  runtime: ReturnType<typeof createNoticeRuntime>;
  sendMessage: ReturnType<typeof vi.fn<NoticeRuntimeDependencies["sendMessage"]>>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createHarness(
  handshake: Promise<RuntimeResponse<unknown>>,
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
  const deactivateOverlay = vi.fn();
  const activateOverlay = vi.fn<(host: NoticeRuntimeHost) => () => void>(() => deactivateOverlay);
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
    activateOverlay,
    getActiveElement: () => document.activeElement,
    restoreFocus,
  });

  return {
    activateOverlay,
    createHost,
    deactivateOverlay,
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

function startDefaultRuntime(data: HandshakeData): () => void {
  entrypoint.sendMessage.mockResolvedValue(success(data));
  let invalidate: () => void = () => undefined;
  const main = contentScript.main as unknown as (context: {
    onInvalidated: (callback: () => void) => () => void;
  }) => void;
  main({
    onInvalidated(callback) {
      invalidate = callback;
      return () => undefined;
    },
  });
  return () => invalidate();
}

afterEach(() => {
  if (document.body === null) {
    document.documentElement.append(document.createElement("body"));
  }
  document.body?.replaceChildren();
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

  it("inerts and scroll-locks bodies that appear or replace while an overlay is rendered", async () => {
    document.body?.remove();
    document.documentElement.style.setProperty("overflow", "visible", "important");
    document.documentElement.style.setProperty("overscroll-behavior", "contain");
    document.head?.setAttribute("inert", "page-owned");
    const invalidate = startDefaultRuntime({
      navigationId: "nav-current",
      notice: directNotice,
    });

    try {
      await waitFor(() => expect(document.querySelectorAll("cloudwatcher-notice")).toHaveLength(1));
      expect(document.body).toBeNull();
      expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
      expect(document.documentElement.style.getPropertyPriority("overflow")).toBe("important");
      expect(document.documentElement.style.getPropertyValue("overscroll-behavior")).toBe("none");

      const firstBody = document.createElement("body");
      document.documentElement.append(firstBody);

      await waitFor(() => expect(firstBody).toHaveAttribute("inert"));
      expect(firstBody.style.getPropertyValue("overflow")).toBe("hidden");
      expect(firstBody.style.getPropertyPriority("overflow")).toBe("important");
      expect(firstBody.style.getPropertyValue("overscroll-behavior")).toBe("none");

      const replacementBody = document.createElement("body");
      replacementBody.setAttribute("inert", "replacement-owned");
      replacementBody.style.setProperty("overflow", "scroll");
      replacementBody.style.setProperty("overscroll-behavior", "auto", "important");
      firstBody.replaceWith(replacementBody);

      await waitFor(() =>
        expect(replacementBody.style.getPropertyValue("overflow")).toBe("hidden"),
      );
      expect(firstBody).not.toHaveAttribute("inert");
      expect(firstBody.style.getPropertyValue("overflow")).toBe("");
      expect(firstBody.style.getPropertyValue("overscroll-behavior")).toBe("");
      expect(firstBody).not.toHaveAttribute("style");

      invalidate();

      expect(replacementBody.getAttribute("inert")).toBe("replacement-owned");
      expect(replacementBody.style.getPropertyValue("overflow")).toBe("scroll");
      expect(replacementBody.style.getPropertyValue("overscroll-behavior")).toBe("auto");
      expect(replacementBody.style.getPropertyPriority("overscroll-behavior")).toBe("important");
      expect(document.documentElement.style.getPropertyValue("overflow")).toBe("visible");
      expect(document.documentElement.style.getPropertyPriority("overflow")).toBe("important");
      expect(document.documentElement.style.getPropertyValue("overscroll-behavior")).toBe(
        "contain",
      );
      expect(document.head?.getAttribute("inert")).toBe("page-owned");
      expect(document.querySelector("cloudwatcher-notice")).not.toBeInTheDocument();
    } finally {
      invalidate();
      document.documentElement.style.removeProperty("overflow");
      document.documentElement.style.removeProperty("overscroll-behavior");
      document.head?.removeAttribute("inert");
      document.body?.removeAttribute("inert");
      document.body?.style.removeProperty("overflow");
      document.body?.style.removeProperty("overscroll-behavior");
    }
  });

  it("reattaches the retained overlay host whenever the page removes it", async () => {
    const invalidate = startDefaultRuntime({
      navigationId: "nav-current",
      notice: directNotice,
    });

    try {
      await waitFor(() => expect(document.querySelectorAll("cloudwatcher-notice")).toHaveLength(1));
      const host = document.querySelector<HTMLElement>("cloudwatcher-notice");
      if (host === null) {
        throw new Error("Expected the overlay host to be mounted");
      }

      host.remove();
      await waitFor(() => expect(host.parentElement).toBe(document.documentElement));

      host.remove();
      await waitFor(() => expect(host.parentElement).toBe(document.documentElement));
      expect(Array.from(document.querySelectorAll("cloudwatcher-notice"))).toEqual([host]);
    } finally {
      invalidate();
    }
  });

  it("moves the retained overlay host back under html after relocation and body replacement", async () => {
    const invalidate = startDefaultRuntime({
      navigationId: "nav-current",
      notice: directNotice,
    });

    try {
      await waitFor(() => expect(document.querySelectorAll("cloudwatcher-notice")).toHaveLength(1));
      const host = document.querySelector<HTMLElement>("cloudwatcher-notice");
      if (host === null) {
        throw new Error("Expected the overlay host to be mounted");
      }

      document.body.append(host);
      await waitFor(() => expect(host.parentElement).toBe(document.documentElement));

      const replacementBody = document.createElement("body");
      document.body.replaceWith(replacementBody);
      replacementBody.append(host);

      await waitFor(() => expect(host.parentElement).toBe(document.documentElement));
      expect(Array.from(document.querySelectorAll("cloudwatcher-notice"))).toEqual([host]);
    } finally {
      invalidate();
    }
  });

  it("restores page-owned inert and scroll mutations made while the overlay is active", async () => {
    const head = document.head;
    const body = document.body;
    head.setAttribute("inert", "before-overlay");
    const invalidate = startDefaultRuntime({
      navigationId: "nav-current",
      notice: directNotice,
    });

    try {
      await waitFor(() => {
        expect(body).toHaveAttribute("inert");
        expect(body.style.getPropertyValue("overflow")).toBe("hidden");
        expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
      });

      head.removeAttribute("inert");
      body.setAttribute("inert", "page-owned");
      body.style.setProperty("overflow", "clip");
      body.style.setProperty("overscroll-behavior", "contain", "important");
      document.documentElement.style.setProperty("overflow", "auto");
      document.documentElement.style.setProperty("overscroll-behavior", "contain");

      await waitFor(() => {
        expect(head).toHaveAttribute("inert");
        expect(body.style.getPropertyValue("overflow")).toBe("hidden");
        expect(body.style.getPropertyValue("overscroll-behavior")).toBe("none");
        expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
        expect(document.documentElement.style.getPropertyValue("overscroll-behavior")).toBe("none");
      });

      invalidate();

      expect(head).not.toHaveAttribute("inert");
      expect(body.getAttribute("inert")).toBe("page-owned");
      expect(body.style.getPropertyValue("overflow")).toBe("clip");
      expect(body.style.getPropertyValue("overscroll-behavior")).toBe("contain");
      expect(body.style.getPropertyPriority("overscroll-behavior")).toBe("important");
      expect(document.documentElement.style.getPropertyValue("overflow")).toBe("auto");
      expect(document.documentElement.style.getPropertyValue("overscroll-behavior")).toBe(
        "contain",
      );
    } finally {
      invalidate();
      head.removeAttribute("inert");
      body.removeAttribute("inert");
      body.style.removeProperty("overflow");
      body.style.removeProperty("overscroll-behavior");
      document.documentElement.style.removeProperty("overflow");
      document.documentElement.style.removeProperty("overscroll-behavior");
    }
  });

  it("leaves page interactivity, scroll styles, and focus untouched for a direct banner", async () => {
    const pageButton = document.createElement("button");
    pageButton.textContent = "Page control";
    document.body.append(pageButton);
    pageButton.focus();
    document.documentElement.style.setProperty("overflow", "visible");
    document.body.style.setProperty("overflow", "auto");
    const invalidate = startDefaultRuntime({
      navigationId: "nav-current",
      notice: directBannerNotice,
    });

    try {
      await waitFor(() => expect(document.querySelectorAll("cloudwatcher-notice")).toHaveLength(1));
      expect(document.body).not.toHaveAttribute("inert");
      expect(document.documentElement.style.getPropertyValue("overflow")).toBe("visible");
      expect(document.body.style.getPropertyValue("overflow")).toBe("auto");
      expect(pageButton).toHaveFocus();
    } finally {
      invalidate();
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
    }
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

  it("activates an overlay guard once and releases it before focus on every exit path", async () => {
    const pageButton = document.createElement("button");
    document.body.append(pageButton);
    pageButton.focus();
    const harness = createHarness(
      Promise.resolve(success({ navigationId: "nav-current", notice: directNotice })),
    );

    await harness.runtime.start();
    expect(harness.activateOverlay).toHaveBeenCalledOnce();

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: directNotice,
    });
    expect(harness.activateOverlay).toHaveBeenCalledOnce();

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: directBannerNotice,
    });
    expect(harness.deactivateOverlay).toHaveBeenCalledOnce();
    expect(harness.deactivateOverlay.mock.invocationCallOrder[0]).toBeLessThan(
      harness.restoreFocus.mock.invocationCallOrder[0] ?? 0,
    );

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: directNotice,
    });
    expect(harness.activateOverlay).toHaveBeenCalledTimes(2);

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: null,
    });
    expect(harness.deactivateOverlay).toHaveBeenCalledTimes(2);
    expect(harness.deactivateOverlay.mock.invocationCallOrder[1]).toBeLessThan(
      harness.restoreFocus.mock.invocationCallOrder[1] ?? 0,
    );

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: directNotice,
    });
    harness.runtime.stop();
    harness.runtime.stop();
    expect(harness.activateOverlay).toHaveBeenCalledTimes(3);
    expect(harness.deactivateOverlay).toHaveBeenCalledTimes(3);
    expect(harness.deactivateOverlay.mock.invocationCallOrder[2]).toBeLessThan(
      harness.restoreFocus.mock.invocationCallOrder[2] ?? 0,
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

  it.each(malformedHandshakeData)(
    "keeps $label inert and does not arm later pushes",
    async ({ data }) => {
      const harness = createHarness(Promise.resolve({ ok: true, data }));

      await expect(harness.runtime.start()).resolves.toBeUndefined();
      expect(harness.createHost).not.toHaveBeenCalled();
      expect(harness.renderNotice).not.toHaveBeenCalled();

      expect(() =>
        harness.listener?.({
          type: "notice/update",
          navigationId: "nav-current",
          notice: directNotice,
        }),
      ).not.toThrow();
      expect(harness.renderNotice).not.toHaveBeenCalled();
    },
  );

  it.each(canonicalHostNotices)("accepts a canonical $label host", async ({ notice }) => {
    const harness = createHarness(
      Promise.resolve(success({ navigationId: "nav-current", notice })),
    );

    await harness.runtime.start();

    expect(harness.renderNotice).toHaveBeenCalledOnce();
    expect(harness.renderNotice).toHaveBeenCalledWith(
      expect.any(Object),
      notice,
      expect.any(Function),
    );
  });

  it("ignores malformed and version-skewed pushes without throwing, then accepts a valid push", async () => {
    const harness = createHarness(
      Promise.resolve(success({ navigationId: "nav-current", notice: null })),
    );
    await harness.runtime.start();

    for (const { message } of malformedPushes) {
      expect(() => harness.listener?.(message)).not.toThrow();
    }
    expect(harness.createHost).not.toHaveBeenCalled();
    expect(harness.renderNotice).not.toHaveBeenCalled();

    harness.listener?.({
      type: "notice/update",
      navigationId: "nav-current",
      notice: contentNotice,
    });
    expect(harness.renderNotice).toHaveBeenCalledOnce();
    expect(harness.renderNotice).toHaveBeenCalledWith(
      expect.any(Object),
      contentNotice,
      expect.any(Function),
    );
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
