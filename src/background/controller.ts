import { type CompiledCidr, compileCidrs, validateCidrText } from "../core/cidr";
import { detectCloudflare } from "../core/detection";
import type {
  HandshakeData,
  PopupState,
  RuntimePush,
  RuntimeRequest,
  RuntimeResponse,
} from "../core/messages";
import {
  DEFAULT_SETTINGS,
  type DetectionCategory,
  type IgnoreRule,
  type NavigationState,
  type Settings,
  type SiteIdentity,
  type StorageSection,
} from "../core/model";
import { getSiteIdentity, isIgnored } from "../core/site-identity";
import type { LocalRepository } from "../storage/local-repository";
import type { SessionNavigationStore } from "../storage/session-navigation-store";
import type { BrowserAdapter } from "./browser-adapter";
import {
  applyDetection,
  deriveNotice,
  disableCategory,
  dismissNotice,
  startNavigation,
  suppressNavigation,
  updateRedirectUrl,
} from "./navigation-state";

export interface BeforeRequestDetails {
  requestId: string;
  tabId: number;
  type: string;
  url: string;
  incognito?: boolean;
}

export interface ResponseStartedDetails {
  requestId: string;
  tabId: number;
  type: string;
  url: string;
  incognito?: boolean;
  responseHeaders?: readonly { name: string; value?: string }[];
  ip?: string;
}

export interface RuntimeMessageSender {
  tab?: { id?: number };
}

interface ControllerOptions {
  createNavigationId?: () => string;
  now?: () => string;
}

const TOP_LEVEL_PROTOCOLS = new Set(["http:", "https:"]);
const RESPONSE_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

function supportedIdentity(url: string, protocols: ReadonlySet<string>): SiteIdentity | undefined {
  try {
    if (!protocols.has(new URL(url).protocol)) {
      return undefined;
    }

    return getSiteIdentity(url);
  } catch {
    return undefined;
  }
}

function success<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function failure(error: unknown): RuntimeResponse<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Cloudwatcher could not complete the request.",
  };
}

function requireTabId(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${source} does not identify a valid tab.`);
  }

  return value;
}

function isOff(settings: Settings, category: DetectionCategory): boolean {
  return category === "direct"
    ? settings.directNoticeMode === "off"
    : settings.contentNoticeMode === "off";
}

function noticePresentationChanged(
  before: ReturnType<typeof deriveNotice>,
  after: ReturnType<typeof deriveNotice>,
): boolean {
  if (before === null || after === null) {
    return before !== after;
  }

  return before.kind !== after.kind || before.mode !== after.mode;
}

function isSameRule(candidate: unknown, expected: IgnoreRule): boolean {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const rule = candidate as Partial<IgnoreRule>;
  return rule.scope === expected.scope && rule.value === expected.value;
}

export class BackgroundController {
  private initialization: Promise<void> | undefined;
  private configurationQueue: Promise<unknown> = Promise.resolve();
  private settings: Settings = DEFAULT_SETTINGS;
  private ignoreRules: IgnoreRule[] = [];
  private ranges: CompiledCidr[] = [];
  private readonly createNavigationId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly repository: LocalRepository,
    private readonly navigationStore: SessionNavigationStore,
    private readonly adapter: BrowserAdapter,
    options: ControllerOptions = {},
  ) {
    this.createNavigationId = options.createNavigationId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  initialize(): Promise<void> {
    this.initialization ??= this.initializeState();
    return this.initialization;
  }

  async handleBeforeRequest(details: BeforeRequestDetails): Promise<void> {
    if (details.tabId < 0 || details.type !== "main_frame") {
      return;
    }

    if (supportedIdentity(details.url, TOP_LEVEL_PROTOCOLS) === undefined) {
      return;
    }

    await this.initialize();
    await this.enqueueConfiguration(() =>
      this.navigationStore.update(details.tabId, async (current) => ({
        state:
          current?.requestId === details.requestId
            ? updateRedirectUrl(current, details.url)
            : startNavigation({
                tabId: details.tabId,
                requestId: details.requestId,
                url: details.url,
                incognito: details.incognito ?? false,
                settings: this.settings,
                ignoreRules: this.ignoreRules,
                navigationId: this.createNavigationId(),
              }),
        value: undefined,
      })),
    );
  }

  async handleResponseStarted(details: ResponseStartedDetails): Promise<void> {
    if (details.tabId < 0) {
      return;
    }

    const responseIdentity = supportedIdentity(details.url, RESPONSE_PROTOCOLS);

    if (responseIdentity === undefined) {
      return;
    }

    await this.initialize();
    const match = detectCloudflare({
      responseHeaders: details.responseHeaders,
      ip: details.ip,
      ranges: this.ranges,
    });

    if (match === null) {
      return;
    }

    const category = details.type === "main_frame" ? "direct" : "content";
    const push = await this.navigationStore.update(details.tabId, async (current) => {
      if (
        current === undefined ||
        (category === "direct" && current.requestId !== details.requestId)
      ) {
        return { state: current, value: undefined };
      }

      const application =
        category === "direct"
          ? applyDetection(current, "direct", match)
          : applyDetection(current, "content", match, responseIdentity.hostname);
      let state = application.state;

      if (application.shouldCount && !current.incognito && details.incognito !== true) {
        try {
          await this.repository.recordDetection(current.identity.siteKey, category, this.now());
        } catch (error) {
          state = {
            ...state,
            counted: { ...state.counted, [category]: false },
          };
          console.warn("Cloudwatcher could not record a detection summary.", error);
        }
      }

      const message: RuntimePush = {
        type: "notice/update",
        navigationId: state.navigationId,
        notice: deriveNotice(state, this.settings),
      };
      return { state, value: message };
    });

    if (push !== undefined) {
      await this.adapter.sendNotice(details.tabId, push);
    }
  }

  async handleMessage(
    message: RuntimeRequest,
    sender: RuntimeMessageSender,
  ): Promise<RuntimeResponse<unknown>> {
    try {
      await this.initialize();

      switch (message.type) {
        case "content/handshake":
          return success(await this.handshake(message.url, sender));
        case "notice/continue":
          await this.continueNavigation(message.navigationId, sender);
          return success(undefined);
        case "notice/ignore":
          await this.ignoreNavigation(message.navigationId, message.rule, sender);
          return success(undefined);
        case "notice/leave":
          await this.leaveNavigation(message.navigationId, sender);
          return success(undefined);
        case "popup/get":
          return success(await this.getPopupState(requireTabId(message.tabId, "Popup request")));
        case "options/get":
          return success(await this.repository.getOptionsSnapshot());
        case "options/update-settings":
          return success(await this.updateSettings(message.settings));
        case "options/remove-ignore":
          return success(await this.removeIgnoreRule(message.rule));
        case "options/save-ranges": {
          const validation = validateCidrText(message.draft);

          if (validation.errors.length > 0) {
            return {
              ok: false,
              error: "One or more CIDR ranges are invalid.",
              validationErrors: validation.errors,
            };
          }

          const ranges = await this.repository.saveRanges(validation.values);
          this.ranges = compileCidrs(ranges);
          return success(ranges);
        }
        case "options/clear-activity":
          return success(await this.repository.clearActivity());
        case "options/reset-section":
          return success(await this.resetSection(message.section));
        default:
          return { ok: false, error: "Unknown runtime request." };
      }
    } catch (error) {
      return failure(error);
    }
  }

  async handleTabRemoved(tabId: number): Promise<void> {
    await this.initialize().catch(() => undefined);
    await this.navigationStore.remove(tabId);
  }

  private async handshake(url: string, sender: RuntimeMessageSender): Promise<HandshakeData> {
    const tabId = requireTabId(sender.tab?.id, "Message sender");

    if (supportedIdentity(url, TOP_LEVEL_PROTOCOLS) === undefined) {
      return { navigationId: null, notice: null };
    }

    return this.navigationStore.update(tabId, async (current) => ({
      state: current,
      value:
        current?.topLevelUrl === url
          ? {
              navigationId: current.navigationId,
              notice: deriveNotice(current, this.settings),
            }
          : { navigationId: null, notice: null },
    }));
  }

  private async continueNavigation(
    navigationId: string,
    sender: RuntimeMessageSender,
  ): Promise<void> {
    const tabId = requireTabId(sender.tab?.id, "Message sender");
    const push = await this.navigationStore.update(tabId, async (current) => {
      const state = this.requireNavigation(current, navigationId);
      const notice = deriveNotice(state, this.settings);

      if (notice === null) {
        throw new Error("There is no current notice to dismiss.");
      }

      const dismissed = dismissNotice(state, notice.kind);
      return {
        state: dismissed,
        value: this.noticePush(dismissed),
      };
    });
    await this.adapter.sendNotice(tabId, push);
  }

  private async ignoreNavigation(
    navigationId: string,
    rule: IgnoreRule,
    sender: RuntimeMessageSender,
  ): Promise<void> {
    const tabId = requireTabId(sender.tab?.id, "Message sender");
    await this.enqueueConfiguration(async () => {
      const push = await this.navigationStore.update(tabId, async (current) => {
        const state = this.requireNavigation(current, navigationId);
        const notice = deriveNotice(state, this.settings);
        const offered = notice?.ignoreChoices.some((choice) => isSameRule(rule, choice.rule));

        if (offered !== true) {
          throw new Error("The ignore rule is not available for this navigation.");
        }

        this.ignoreRules = await this.repository.addIgnoreRule(rule);
        const suppressed = suppressNavigation(state);
        return {
          state: suppressed,
          value: this.noticePush(suppressed),
        };
      });
      await this.adapter.sendNotice(tabId, push);
    });
  }

  private async leaveNavigation(navigationId: string, sender: RuntimeMessageSender): Promise<void> {
    const tabId = requireTabId(sender.tab?.id, "Message sender");
    await this.navigationStore.update(tabId, async (current) => {
      const state = this.requireNavigation(current, navigationId);
      return { state, value: undefined };
    });

    try {
      await this.adapter.goBack(tabId);
    } catch {
      await this.adapter.replaceWithBlank(tabId);
    }
  }

  private async getPopupState(tabId: number): Promise<PopupState> {
    const tabUrl = await this.adapter.getTabUrl(tabId);
    const tabIdentity =
      tabUrl === undefined ? undefined : supportedIdentity(tabUrl, TOP_LEVEL_PROTOCOLS);

    if (tabUrl === undefined || tabIdentity === undefined) {
      return { status: "unavailable", ignored: false, evidence: [] };
    }

    const state = await this.navigationStore.update(tabId, async (current) => ({
      state: current,
      value: current,
    }));
    const current = state?.topLevelUrl === tabUrl ? state : undefined;
    const identity = current?.identity ?? tabIdentity;
    const snapshot = await this.repository.getOptionsSnapshot();
    const summary = snapshot.summaries[identity.siteKey];

    if (current?.direct !== undefined) {
      return {
        status: "direct",
        ignored: current.suppressedForNavigation || isIgnored(identity, this.ignoreRules),
        hostname: identity.hostname,
        evidence: current.direct.match.evidence,
        ...(summary === undefined ? {} : { summary }),
      };
    }

    if (current?.content !== undefined) {
      return {
        status: "content",
        ignored: current.suppressedForNavigation || isIgnored(identity, this.ignoreRules),
        hostname: identity.hostname,
        contentHost: current.content.resourceHost,
        evidence: current.content.match.evidence,
        ...(summary === undefined ? {} : { summary }),
      };
    }

    return {
      status: "none",
      ignored: current?.suppressedForNavigation || isIgnored(identity, this.ignoreRules),
      hostname: identity.hostname,
      evidence: [],
      ...(summary === undefined ? {} : { summary }),
    };
  }

  private updateSettings(settings: Settings): Promise<Settings> {
    return this.enqueueConfiguration(async () => {
      const previous = this.settings;
      const replacement = await this.repository.updateSettings(settings);
      this.settings = replacement;
      await this.applySettingsToOpenNavigations(previous, replacement);
      return replacement;
    });
  }

  private removeIgnoreRule(rule: IgnoreRule): Promise<IgnoreRule[]> {
    return this.enqueueConfiguration(async () => {
      const rules = await this.repository.removeIgnoreRule(rule);
      this.ignoreRules = rules;
      return rules;
    });
  }

  private async applySettingsToOpenNavigations(
    previous: Settings,
    replacement: Settings,
  ): Promise<void> {
    const openNavigations = await this.navigationStore.list();

    for (const navigation of openNavigations) {
      const push = await this.navigationStore.update(navigation.tabId, async (current) => {
        if (current === undefined) {
          return { value: undefined };
        }

        const before = deriveNotice(current, previous);
        let state = current;

        for (const category of ["direct", "content"] as const) {
          if (isOff(replacement, category) && state.eligible[category]) {
            state = disableCategory(state, category);
          }
        }

        const after = deriveNotice(state, replacement);
        return {
          state,
          value: noticePresentationChanged(before, after)
            ? {
                type: "notice/update" as const,
                navigationId: state.navigationId,
                notice: after,
              }
            : undefined,
        };
      });

      if (push !== undefined) {
        await this.adapter.sendNotice(navigation.tabId, push);
      }
    }
  }

  private resetSection(section: StorageSection): Promise<unknown> {
    return this.enqueueConfiguration(async () => {
      const previousSettings = this.settings;
      const replacement = await this.repository.resetSection(section);
      const snapshot = await this.repository.getOptionsSnapshot();

      switch (section) {
        case "settings":
          this.settings = snapshot.settings;
          await this.applySettingsToOpenNavigations(previousSettings, this.settings);
          break;
        case "ignoreRules":
          this.ignoreRules = snapshot.ignoreRules;
          break;
        case "ipRanges":
          this.ranges = compileCidrs(snapshot.ipRanges);
          break;
        case "summaries":
          break;
      }

      return replacement;
    });
  }

  private requireNavigation(
    state: NavigationState | undefined,
    navigationId: string,
  ): NavigationState {
    if (state === undefined || state.navigationId !== navigationId) {
      throw new Error("The navigation is no longer current.");
    }

    return state;
  }

  private noticePush(state: NavigationState): RuntimePush {
    return {
      type: "notice/update",
      navigationId: state.navigationId,
      notice: deriveNotice(state, this.settings),
    };
  }

  private enqueueConfiguration<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.configurationQueue.then(operation, operation);
    this.configurationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async initializeState(): Promise<void> {
    await this.repository.initialize();
    const snapshot = await this.repository.getOptionsSnapshot();
    this.settings = snapshot.settings;
    this.ignoreRules = snapshot.ignoreRules;
    this.ranges = compileCidrs(snapshot.ipRanges);
  }
}
