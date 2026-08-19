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
  activateOverlay: (host: NoticeRuntimeHost) => () => void;
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

interface InlineStyleState {
  value: string;
  priority: string;
}

interface PageElementState {
  inertAttribute: string | null;
  inertProperty: boolean | undefined;
  hadStyleAttribute?: boolean;
  overflow?: InlineStyleState;
  overscrollBehavior?: InlineStyleState;
}

function readInlineStyle(element: HTMLElement, property: string): InlineStyleState {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function restoreInlineStyle(element: HTMLElement, property: string, state: InlineStyleState): void {
  if (state.value === "") {
    element.style.removeProperty(property);
  } else {
    element.style.setProperty(property, state.value, state.priority);
  }
}

function lockScroll(element: HTMLElement): void {
  if (
    element.style.getPropertyValue("overflow") !== "hidden" ||
    element.style.getPropertyPriority("overflow") !== "important"
  ) {
    element.style.setProperty("overflow", "hidden", "important");
  }
  if (
    element.style.getPropertyValue("overscroll-behavior") !== "none" ||
    element.style.getPropertyPriority("overscroll-behavior") !== "important"
  ) {
    element.style.setProperty("overscroll-behavior", "none", "important");
  }
}

function createOverlayPageGuard(targetDocument: Document, host: HTMLElement): () => void {
  const documentElement = targetDocument.documentElement;
  const documentStyle = {
    hadAttribute: documentElement.hasAttribute("style"),
    overflow: readInlineStyle(documentElement, "overflow"),
    overscrollBehavior: readInlineStyle(documentElement, "overscroll-behavior"),
  };
  const elementStates = new Map<HTMLElement, PageElementState>();
  let released = false;

  function restoreElement(element: HTMLElement, state: PageElementState): void {
    if (state.inertProperty !== undefined) {
      element.inert = state.inertProperty;
    }
    if (state.inertAttribute === null) {
      element.removeAttribute("inert");
    } else {
      element.setAttribute("inert", state.inertAttribute);
    }
    if (state.overflow !== undefined && state.overscrollBehavior !== undefined) {
      restoreInlineStyle(element, "overflow", state.overflow);
      restoreInlineStyle(element, "overscroll-behavior", state.overscrollBehavior);
      if (state.hadStyleAttribute === false && element.style.length === 0) {
        element.removeAttribute("style");
      }
    }
  }

  function lockElement(element: HTMLElement): void {
    let state = elementStates.get(element);
    if (state === undefined) {
      const locksScroll = element.tagName === "BODY";
      state = {
        inertAttribute: element.getAttribute("inert"),
        inertProperty: "inert" in element ? element.inert : undefined,
        ...(locksScroll
          ? {
              hadStyleAttribute: element.hasAttribute("style"),
              overflow: readInlineStyle(element, "overflow"),
              overscrollBehavior: readInlineStyle(element, "overscroll-behavior"),
            }
          : {}),
      };
      elementStates.set(element, state);
      observer.observe(element, {
        attributes: true,
        attributeFilter: locksScroll ? ["inert", "style"] : ["inert"],
      });
    }

    if (!element.hasAttribute("inert")) {
      element.setAttribute("inert", "");
    }
    if ("inert" in element && !element.inert) {
      element.inert = true;
    }
    if (state.overflow !== undefined) {
      lockScroll(element);
    }
  }

  function reconcile(): void {
    if (released) {
      return;
    }

    lockScroll(documentElement);
    for (const [element, state] of elementStates) {
      if (element.parentElement !== documentElement || element === host) {
        restoreElement(element, state);
        elementStates.delete(element);
      }
    }
    for (const child of documentElement.children) {
      if (child !== host && child instanceof HTMLElement) {
        lockElement(child);
      }
    }
  }

  const Observer = targetDocument.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer(reconcile);
  observer.observe(documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  reconcile();

  return () => {
    if (released) {
      return;
    }

    released = true;
    observer.disconnect();
    for (const [element, state] of elementStates) {
      restoreElement(element, state);
    }
    elementStates.clear();
    restoreInlineStyle(documentElement, "overflow", documentStyle.overflow);
    restoreInlineStyle(documentElement, "overscroll-behavior", documentStyle.overscrollBehavior);
    if (!documentStyle.hadAttribute && documentElement.style.length === 0) {
      documentElement.removeAttribute("style");
    }
  };
}

const HEADER_SIGNALS = new Set(["cf-ray", "cf-cache-status", "cf-mitigated", "server: cloudflare"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEvidence(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "header") {
    return typeof value.signal === "string" && HEADER_SIGNALS.has(value.signal);
  }
  if (value.kind === "ip") {
    return isNonEmptyString(value.ip) && isNonEmptyString(value.cidr);
  }
  return false;
}

function isIgnoreChoice(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.label) || !isRecord(value.rule)) {
    return false;
  }
  return (
    (value.rule.scope === "host" || value.rule.scope === "site") &&
    isNonEmptyString(value.rule.value)
  );
}

function isNoticeState(value: unknown): value is NoticeState {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.navigationId) ||
    !isNonEmptyString(value.siteHost) ||
    !Array.isArray(value.evidence) ||
    !Array.from(value.evidence).every(isEvidence) ||
    !Array.isArray(value.ignoreChoices) ||
    !Array.from(value.ignoreChoices).every(isIgnoreChoice)
  ) {
    return false;
  }

  if (value.kind === "direct") {
    return (
      (value.mode === "overlay" || value.mode === "banner") &&
      (value.resourceHost === undefined || isNonEmptyString(value.resourceHost))
    );
  }
  return (
    value.kind === "content" && value.mode === "banner" && isNonEmptyString(value.resourceHost)
  );
}

function isHandshakeData(value: unknown): value is HandshakeData {
  if (!isRecord(value)) {
    return false;
  }
  if (value.navigationId === null) {
    return value.notice === null;
  }
  return (
    isNonEmptyString(value.navigationId) &&
    (value.notice === null ||
      (isNoticeState(value.notice) && value.notice.navigationId === value.navigationId))
  );
}

function isRuntimePush(value: unknown): value is RuntimePush {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.type === "notice/update" &&
    isNonEmptyString(value.navigationId) &&
    (value.notice === null ||
      (isNoticeState(value.notice) && value.notice.navigationId === value.navigationId))
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
  let deactivateOverlay: (() => void) | undefined;
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

  function releaseOverlay(): void {
    const release = deactivateOverlay;
    deactivateOverlay = undefined;
    release?.();
  }

  function removeRenderedNotice(): void {
    const shouldRestore = currentNotice?.mode === "overlay";

    try {
      if (mountedHost !== null) {
        dependencies.removeHost(mountedHost);
      }
    } finally {
      mountedHost = null;
      currentNotice = null;
      pageFocusBeforeHost = null;
      releaseOverlay();

      if (shouldRestore) {
        restoreOverlayFocus();
      }
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

    if (enteringOverlay) {
      deactivateOverlay = dependencies.activateOverlay(mountedHost);
    }
    try {
      dependencies.renderNotice(mountedHost, notice, performAction);
    } catch (error) {
      if (enteringOverlay) {
        releaseOverlay();
      }
      throw error;
    }
    currentNotice = notice;

    if (wasOverlay && notice.mode !== "overlay") {
      releaseOverlay();
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
    if (stopped || !ready || activeNavigationId === null) {
      return;
    }

    let push: RuntimePush;
    try {
      if (!isRuntimePush(message)) {
        return;
      }
      push = message;
    } catch {
      return;
    }

    if (push.navigationId !== activeNavigationId) {
      return;
    }

    if (push.notice === null) {
      removeRenderedNotice();
      return;
    }

    if (push.notice.navigationId === activeNavigationId) {
      showNotice(push.notice);
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
      activateOverlay: ({ host }) => createOverlayPageGuard(document, host),
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
