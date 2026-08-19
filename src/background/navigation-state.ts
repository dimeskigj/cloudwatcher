import {
  DEFAULT_SETTINGS,
  type DetectionCategory,
  type DetectionMatch,
  type NavigationState,
  type NoticeState,
  type Settings,
} from "../core/model";
import { getIgnoreChoices, getSiteIdentity } from "../core/site-identity";

interface DetectionApplication {
  state: NavigationState;
  shouldCount: boolean;
}

export function startNavigation({
  tabId,
  requestId,
  url,
  incognito,
  settings,
  ignored,
  navigationId,
}: {
  tabId: number;
  requestId: string;
  url: string;
  incognito: boolean;
  settings: Settings;
  ignored: boolean;
  navigationId: string;
}): NavigationState {
  return {
    tabId,
    requestId,
    navigationId,
    topLevelUrl: url,
    identity: getSiteIdentity(url),
    incognito,
    counted: { direct: false, content: false },
    dismissed: { direct: false, content: false },
    eligible: {
      direct: settings.directNoticeMode !== "off",
      content: settings.contentNoticeMode !== "off",
    },
    suppressedForNavigation: ignored,
  };
}

export function updateRedirectUrl(
  state: NavigationState,
  url: string,
  ignored: boolean,
): NavigationState {
  return {
    ...state,
    topLevelUrl: url,
    identity: getSiteIdentity(url),
    suppressedForNavigation: ignored,
  };
}

export function applyDetection(
  state: NavigationState,
  category: "direct",
  match: DetectionMatch,
): DetectionApplication;
export function applyDetection(
  state: NavigationState,
  category: "content",
  match: DetectionMatch,
  resourceHost: string,
): DetectionApplication;
export function applyDetection(
  state: NavigationState,
  category: DetectionCategory,
  match: DetectionMatch,
  resourceHost?: string,
): DetectionApplication {
  if (category === "direct") {
    return {
      state: {
        ...state,
        direct: state.direct ?? { match },
        counted: { ...state.counted, direct: true },
      },
      shouldCount: !state.counted.direct,
    };
  }

  let content = state.content;

  if (content === undefined) {
    if (resourceHost === undefined) {
      throw new TypeError("Content detection requires a resource host");
    }

    content = { match, resourceHost };
  }

  return {
    state: {
      ...state,
      content,
      counted: { ...state.counted, content: true },
    },
    shouldCount: !state.counted.content,
  };
}

export function deriveNotice(
  state: NavigationState,
  settings: Settings = DEFAULT_SETTINGS,
): NoticeState | null {
  if (state.suppressedForNavigation) {
    return null;
  }

  if (state.direct !== undefined) {
    if (!state.eligible.direct || state.dismissed.direct || settings.directNoticeMode === "off") {
      return null;
    }

    return {
      navigationId: state.navigationId,
      kind: "direct",
      mode: settings.directNoticeMode,
      siteHost: state.identity.hostname,
      evidence: state.direct.match.evidence,
      ignoreChoices: getIgnoreChoices(state.identity),
    };
  }

  if (
    state.content === undefined ||
    !state.eligible.content ||
    state.dismissed.content ||
    settings.contentNoticeMode === "off"
  ) {
    return null;
  }

  return {
    navigationId: state.navigationId,
    kind: "content",
    mode: "banner",
    siteHost: state.identity.hostname,
    resourceHost: state.content.resourceHost,
    evidence: state.content.match.evidence,
    ignoreChoices: getIgnoreChoices(state.identity),
  };
}

export function dismissNotice(
  state: NavigationState,
  category: DetectionCategory,
): NavigationState {
  return {
    ...state,
    dismissed: { ...state.dismissed, [category]: true },
  };
}

export function suppressNavigation(state: NavigationState): NavigationState {
  return { ...state, suppressedForNavigation: true };
}

export function disableCategory(
  state: NavigationState,
  category: DetectionCategory,
): NavigationState {
  return {
    ...state,
    eligible: { ...state.eligible, [category]: false },
  };
}
