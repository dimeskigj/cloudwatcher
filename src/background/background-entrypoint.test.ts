import { beforeEach, describe, expect, it, vi } from "vitest";

const entrypoint = vi.hoisted(() => {
  const controller = {
    initialize: vi.fn(),
    handleBeforeRequest: vi.fn(),
    handleResponseStarted: vi.fn(),
    handleMessage: vi.fn(),
    handleTabRemoved: vi.fn(),
  };
  const addBeforeRequest = vi.fn();
  const addResponseStarted = vi.fn();
  const addMessage = vi.fn();
  const addRemoved = vi.fn();
  const browser = {
    storage: { local: {}, session: {} },
    webRequest: {
      onBeforeRequest: { addListener: addBeforeRequest },
      onResponseStarted: { addListener: addResponseStarted },
    },
    runtime: { onMessage: { addListener: addMessage } },
    tabs: { onRemoved: { addListener: addRemoved } },
  };
  const defineBackground = vi.fn((register: () => void) => {
    register();
    return register;
  });

  return {
    addBeforeRequest,
    addMessage,
    addRemoved,
    addResponseStarted,
    browser,
    controller,
    defineBackground,
  };
});

vi.mock("wxt/browser", () => ({ browser: entrypoint.browser }));
vi.mock("wxt/utils/define-background", () => ({ defineBackground: entrypoint.defineBackground }));
vi.mock("#imports", () => ({
  browser: entrypoint.browser,
  defineBackground: entrypoint.defineBackground,
}));
vi.mock("@/background/browser-adapter", () => ({ createBrowserAdapter: vi.fn(() => ({})) }));
vi.mock("@/background/controller", () => ({
  BackgroundController: class {
    initialize() {
      return entrypoint.controller.initialize();
    }

    handleBeforeRequest(details: unknown) {
      return entrypoint.controller.handleBeforeRequest(details);
    }

    handleResponseStarted(details: unknown) {
      return entrypoint.controller.handleResponseStarted(details);
    }

    handleMessage(message: unknown, sender: unknown) {
      return entrypoint.controller.handleMessage(message, sender);
    }

    handleTabRemoved(tabId: number) {
      return entrypoint.controller.handleTabRemoved(tabId);
    }
  },
}));
vi.mock("@/storage/local-repository", () => ({
  LocalRepository: class {},
}));
vi.mock("@/storage/session-navigation-store", () => ({
  SessionNavigationStore: class {},
}));

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function loadBackground() {
  vi.resetModules();
  await import("../entrypoints/background");
}

describe("background entrypoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("browser", entrypoint.browser);
    vi.stubGlobal("defineBackground", entrypoint.defineBackground);
  });

  it("registers every listener synchronously with the required webRequest filters", async () => {
    const initialization = deferred<void>();
    entrypoint.controller.initialize.mockReturnValue(initialization.promise);
    entrypoint.controller.handleTabRemoved.mockReturnValue(new Promise<void>(() => undefined));

    await loadBackground();

    expect(entrypoint.addBeforeRequest).toHaveBeenCalledOnce();
    expect(entrypoint.addResponseStarted).toHaveBeenCalledOnce();
    expect(entrypoint.addMessage).toHaveBeenCalledOnce();
    expect(entrypoint.addRemoved).toHaveBeenCalledOnce();
    const [beforeRequest, beforeFilter] = entrypoint.addBeforeRequest.mock.calls[0] ?? [];
    const [responseStarted, responseFilter, responseOptions] =
      entrypoint.addResponseStarted.mock.calls[0] ?? [];
    const [onMessage] = entrypoint.addMessage.mock.calls[0] ?? [];
    const [onRemoved] = entrypoint.addRemoved.mock.calls[0] ?? [];

    expect(beforeFilter).toEqual({ urls: ["<all_urls>"], types: ["main_frame"] });
    expect(responseFilter).toEqual({ urls: ["<all_urls>"] });
    expect(responseOptions).toEqual(["responseHeaders"]);
    expect(beforeRequest({ requestId: "main" })).toBeUndefined();
    expect(responseStarted({ requestId: "resource" })).toBeUndefined();
    expect(onRemoved(8)).toBeUndefined();
    expect(onMessage({ type: "options/get" }, {})).toBeInstanceOf(Promise);
    expect(entrypoint.controller.handleBeforeRequest).not.toHaveBeenCalled();
    expect(entrypoint.controller.handleResponseStarted).not.toHaveBeenCalled();
  });

  it("attaches error logging to every fire-and-forget listener chain", async () => {
    const error = new Error("handler failed");
    entrypoint.controller.initialize.mockResolvedValue(undefined);
    entrypoint.controller.handleBeforeRequest.mockRejectedValue(error);
    entrypoint.controller.handleResponseStarted.mockRejectedValue(error);
    entrypoint.controller.handleTabRemoved.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await loadBackground();
    const [beforeRequest] = entrypoint.addBeforeRequest.mock.calls[0] ?? [];
    const [responseStarted] = entrypoint.addResponseStarted.mock.calls[0] ?? [];
    const [onRemoved] = entrypoint.addRemoved.mock.calls[0] ?? [];
    beforeRequest({ requestId: "main" });
    responseStarted({ requestId: "resource" });
    onRemoved(8);

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(3));
    expect(consoleError).toHaveBeenCalledWith("Cloudwatcher background handler failed.", error);
  });

  it("observes eager initialization rejection without hiding it from event handlers", async () => {
    const initialization = deferred<void>();
    const observeRejection = vi.spyOn(initialization.promise, "catch");
    const error = new Error("initialization failed");
    entrypoint.controller.initialize.mockReturnValue(initialization.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await loadBackground();

    expect(observeRejection).toHaveBeenCalledOnce();
    const testObserver = initialization.promise.catch(() => undefined);
    const [beforeRequest] = entrypoint.addBeforeRequest.mock.calls[0] ?? [];
    const [onMessage] = entrypoint.addMessage.mock.calls[0] ?? [];
    initialization.reject(error);
    await testObserver;
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));

    expect(beforeRequest({ requestId: "main" })).toBeUndefined();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));
    await expect(onMessage({ type: "options/get" }, {})).rejects.toBe(error);
    expect(entrypoint.controller.handleBeforeRequest).not.toHaveBeenCalled();
    expect(entrypoint.controller.handleMessage).not.toHaveBeenCalled();
  });
});
