import { render } from "preact";
import type { HandshakeData, RuntimePush, RuntimeRequest, RuntimeResponse } from "@/core/messages";
import type { NoticeState } from "@/core/model";
import { Notice, type NoticeAction } from "./Notice";
import noticeCss from "./notice.css?inline";

export interface NoticeRuntimeHost {
  host: HTMLElement;
  root: ShadowRoot;
  mount: HTMLElement;
}

export interface NoticeRuntimeDependencies {
  url: string;
  sendMessage: (request: RuntimeRequest) => Promise<RuntimeResponse<unknown>>;
  subscribe: (listener: (message: unknown) => void) => () => void;
  createHost: () => NoticeRuntimeHost;
  renderNotice: (
    host: NoticeRuntimeHost,
    notice: NoticeState,
    onAction: (action: NoticeAction) => Promise<void>,
  ) => void;
  removeHost: (host: NoticeRuntimeHost) => void;
  getActiveElement: () => Element | null;
  restoreFocus: (target: Element) => void;
}

export function createClosedNoticeHost(
  targetDocument: Document,
  cssText: string,
): NoticeRuntimeHost {
  const host = targetDocument.createElement("cloudwatcher-notice");
  targetDocument.documentElement.append(host);
  const root = host.attachShadow({ mode: "closed" });
  const style = targetDocument.createElement("style");
  style.textContent = cssText;
  const mount = targetDocument.createElement("div");
  root.append(style, mount);
  return { host, root, mount };
}

function isHandshakeData(value: unknown): value is HandshakeData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<HandshakeData>;
  return (
    (candidate.navigationId === null || typeof candidate.navigationId === "string") &&
    (candidate.notice === null || typeof candidate.notice === "object")
  );
}

function isRuntimePush(value: unknown): value is RuntimePush {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RuntimePush>;
  return (
    candidate.type === "notice/update" &&
    typeof candidate.navigationId === "string" &&
    (candidate.notice === null || typeof candidate.notice === "object")
  );
}

function actionRequest(action: NoticeAction, navigationId: string): RuntimeRequest {
  switch (action.type) {
    case "continue":
      return { type: "notice/continue", navigationId };
    case "leave":
      return { type: "notice/leave", navigationId };
    case "ignore":
      return { type: "notice/ignore", navigationId, rule: action.rule };
  }
}

export function createNoticeRuntime(dependencies: NoticeRuntimeDependencies) {
  let activeNavigationId: string | null = null;
  let currentNotice: NoticeState | null = null;
  let mountedHost: NoticeRuntimeHost | null = null;
  let overlayRestoreTarget: Element | null = null;
  let pageFocusBeforeHost: Element | null = null;
  let unsubscribe: (() => void) | undefined;
  let startPromise: Promise<void> | undefined;
  let ready = false;
  let stopped = false;

  function restoreOverlayFocus(): void {
    const target = overlayRestoreTarget;
    overlayRestoreTarget = null;

    if (target?.isConnected === true) {
      dependencies.restoreFocus(target);
    }
  }

  function removeRenderedNotice(): void {
    const shouldRestore = currentNotice?.mode === "overlay";

    if (mountedHost !== null) {
      dependencies.removeHost(mountedHost);
      mountedHost = null;
    }

    currentNotice = null;
    pageFocusBeforeHost = null;

    if (shouldRestore) {
      restoreOverlayFocus();
    }
  }

  function showNotice(notice: NoticeState): void {
    const wasOverlay = currentNotice?.mode === "overlay";
    const enteringOverlay = notice.mode === "overlay" && !wasOverlay;

    if (enteringOverlay) {
      const activeElement = dependencies.getActiveElement();
      overlayRestoreTarget =
        activeElement !== mountedHost?.host ? activeElement : pageFocusBeforeHost;
    }

    if (mountedHost === null) {
      pageFocusBeforeHost = dependencies.getActiveElement();
      mountedHost = dependencies.createHost();
    }

    dependencies.renderNotice(mountedHost, notice, performAction);
    currentNotice = notice;

    if (wasOverlay && notice.mode !== "overlay") {
      restoreOverlayFocus();
    }
  }

  async function performAction(action: NoticeAction): Promise<void> {
    if (stopped || !ready || activeNavigationId === null) {
      throw new Error("The Cloudwatcher notice is no longer current.");
    }

    const response = await dependencies.sendMessage(actionRequest(action, activeNavigationId));
    if (!response.ok) {
      throw new Error(response.error);
    }
  }

  function receiveMessage(message: unknown): void {
    if (stopped || !ready || activeNavigationId === null || !isRuntimePush(message)) {
      return;
    }

    if (message.navigationId !== activeNavigationId) {
      return;
    }

    if (message.notice === null) {
      removeRenderedNotice();
      return;
    }

    if (message.notice.navigationId === activeNavigationId) {
      showNotice(message.notice);
    }
  }

  async function handshake(): Promise<void> {
    try {
      const response = await dependencies.sendMessage({
        type: "content/handshake",
        url: dependencies.url,
      });

      if (stopped || !response.ok || !isHandshakeData(response.data)) {
        return;
      }

      const { navigationId, notice } = response.data;
      if (navigationId === null) {
        return;
      }

      activeNavigationId = navigationId;
      ready = true;

      if (notice !== null && notice.navigationId === navigationId) {
        showNotice(notice);
      }
    } catch {
      // A failed handshake leaves the page untouched; a later navigation reinjects the script.
    }
  }

  function start(): Promise<void> {
    if (startPromise !== undefined) {
      return startPromise;
    }

    if (stopped) {
      return Promise.resolve();
    }

    unsubscribe = dependencies.subscribe(receiveMessage);
    startPromise = handshake();
    return startPromise;
  }

  function stop(): void {
    if (stopped) {
      return;
    }

    stopped = true;
    ready = false;
    activeNavigationId = null;
    unsubscribe?.();
    unsubscribe = undefined;
    removeRenderedNotice();
  }

  return { start, stop };
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: false,
  runAt: "document_start",
  world: "ISOLATED",
  main(ctx) {
    const runtime = createNoticeRuntime({
      url: location.href,
      sendMessage: (request) =>
        browser.runtime.sendMessage(request) as Promise<RuntimeResponse<unknown>>,
      subscribe: (receive) => {
        const listener = (message: unknown) => receive(message);
        browser.runtime.onMessage.addListener(listener);
        return () => browser.runtime.onMessage.removeListener(listener);
      },
      createHost: () => createClosedNoticeHost(document, noticeCss),
      renderNotice: ({ mount }, notice, onAction) => {
        render(
          <Notice
            key={`${notice.navigationId}:${notice.kind}:${notice.mode}`}
            notice={notice}
            onAction={onAction}
          />,
          mount,
        );
      },
      removeHost: ({ host, mount }) => {
        render(null, mount);
        host.remove();
      },
      getActiveElement: () => document.activeElement,
      restoreFocus: (target) => {
        if (target instanceof HTMLElement) {
          target.focus();
        }
      },
    });
    ctx.onInvalidated(() => runtime.stop());
    void runtime.start();
  },
});
