import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DetectionMatch, type Settings } from "../core/model";
import {
  applyDetection,
  deriveNotice,
  disableCategory,
  dismissNotice,
  startNavigation,
  suppressNavigation,
  updateRedirectUrl,
} from "./navigation-state";

const headerMatch: DetectionMatch = {
  evidence: [{ kind: "header", signal: "cf-ray" }],
};

const ipMatch: DetectionMatch = {
  evidence: [{ kind: "ip", ip: "203.0.113.7", cidr: "203.0.113.0/24" }],
};

function start(
  overrides: Partial<{
    tabId: number;
    requestId: string;
    url: string;
    incognito: boolean;
    settings: Settings;
    ignored: boolean;
    navigationId: string;
  }> = {},
) {
  return startNavigation({
    tabId: 4,
    requestId: "r1",
    url: "https://shop.example.com/",
    incognito: false,
    settings: DEFAULT_SETTINGS,
    ignored: false,
    navigationId: "nav-1",
    ...overrides,
  });
}

describe("navigation state", () => {
  it("starts each request with fresh state and eligibility fixed from its starting settings", () => {
    const settings: Settings = {
      directNoticeMode: "banner",
      contentNoticeMode: "off",
    };

    const first = start({ settings, ignored: true });
    const second = start({ requestId: "r2", navigationId: "nav-2" });

    expect(first).toEqual({
      tabId: 4,
      requestId: "r1",
      navigationId: "nav-1",
      topLevelUrl: "https://shop.example.com/",
      identity: {
        hostname: "shop.example.com",
        siteKey: "example.com",
        registrableDomain: "example.com",
      },
      incognito: false,
      counted: { direct: false, content: false },
      dismissed: { direct: false, content: false },
      eligible: { direct: true, content: false },
      suppressedForNavigation: true,
    });
    expect(second).toMatchObject({
      requestId: "r2",
      navigationId: "nav-2",
      counted: { direct: false, content: false },
      dismissed: { direct: false, content: false },
      eligible: { direct: true, content: true },
      suppressedForNavigation: false,
    });
  });

  it("preserves same-request state while replacing cross-domain redirect identity and ignore status", () => {
    const initial = start({
      url: "https://redirector.example/",
      settings: { directNoticeMode: "off", contentNoticeMode: "banner" },
      ignored: true,
    });
    const detected = applyDetection(
      initial,
      "content",
      headerMatch,
      "cdn.redirector.example",
    ).state;
    const dismissed = dismissNotice(detected, "content");

    const finalState = updateRedirectUrl(dismissed, "https://account.example.net/final", false);

    expect(finalState).toEqual({
      ...dismissed,
      topLevelUrl: "https://account.example.net/final",
      identity: {
        hostname: "account.example.net",
        siteKey: "example.net",
        registrableDomain: "example.net",
      },
      suppressedForNavigation: false,
    });
    expect(finalState.navigationId).toBe("nav-1");
    expect(finalState.requestId).toBe("r1");
    expect(finalState.eligible).toEqual({ direct: false, content: true });
    expect(finalState.content).toEqual({
      match: headerMatch,
      resourceHost: "cdn.redirector.example",
    });
    expect(updateRedirectUrl(finalState, "https://ignored.test/", true)).toMatchObject({
      identity: { hostname: "ignored.test", siteKey: "ignored.test" },
      suppressedForNavigation: true,
    });
    expect(initial.suppressedForNavigation).toBe(true);
  });

  it("keeps the first content match and host and counts the category only once", () => {
    const state = start();

    const first = applyDetection(state, "content", headerMatch, "cdn.example");
    const repeated = applyDetection(first.state, "content", ipMatch, "assets.example");

    expect(first.shouldCount).toBe(true);
    expect(repeated.shouldCount).toBe(false);
    expect(repeated.state.content).toEqual({ match: headerMatch, resourceHost: "cdn.example" });
    expect(deriveNotice(repeated.state)).toEqual({
      navigationId: "nav-1",
      kind: "content",
      mode: "banner",
      siteHost: "shop.example.com",
      resourceHost: "cdn.example",
      evidence: headerMatch.evidence,
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
    });
    expect(state.content).toBeUndefined();
    expect(state.counted.content).toBe(false);
  });

  it("keeps the first direct match and maintains an independent count guard per category", () => {
    const content = applyDetection(start(), "content", headerMatch, "cdn.example");
    const direct = applyDetection(content.state, "direct", ipMatch);
    const repeatedDirect = applyDetection(direct.state, "direct", headerMatch);
    const repeatedContent = applyDetection(
      repeatedDirect.state,
      "content",
      ipMatch,
      "assets.example",
    );

    expect(content.shouldCount).toBe(true);
    expect(direct.shouldCount).toBe(true);
    expect(repeatedDirect.shouldCount).toBe(false);
    expect(repeatedContent.shouldCount).toBe(false);
    expect(repeatedContent.state.counted).toEqual({ direct: true, content: true });
    expect(repeatedContent.state.direct).toEqual({ match: ipMatch });
  });

  it("gives an eligible direct detection priority over an earlier content notice", () => {
    const content = applyDetection(start(), "content", headerMatch, "cdn.example");
    const direct = applyDetection(content.state, "direct", ipMatch);

    expect(deriveNotice(content.state)).toMatchObject({ kind: "content", mode: "banner" });
    expect(deriveNotice(direct.state)).toEqual({
      navigationId: "nav-1",
      kind: "direct",
      mode: "overlay",
      siteHost: "shop.example.com",
      evidence: ipMatch.evidence,
      ignoreChoices: expect.any(Array),
    });
  });

  it("returns no notice instead of falling back to content when direct detection is ineligible", () => {
    const settings: Settings = {
      directNoticeMode: "off",
      contentNoticeMode: "banner",
    };
    const content = applyDetection(start({ settings }), "content", headerMatch, "cdn.example");
    const direct = applyDetection(content.state, "direct", ipMatch);

    expect(deriveNotice(content.state, settings)).toMatchObject({ kind: "content" });
    expect(direct.shouldCount).toBe(true);
    expect(deriveNotice(direct.state, settings)).toBeNull();
  });

  it("uses the active direct presentation mode without rearming off-at-start eligibility", () => {
    const bannerSettings: Settings = {
      directNoticeMode: "banner",
      contentNoticeMode: "banner",
    };
    const banner = applyDetection(start({ settings: bannerSettings }), "direct", headerMatch).state;
    const ineligible = applyDetection(
      start({ settings: { ...bannerSettings, directNoticeMode: "off" } }),
      "direct",
      headerMatch,
    ).state;

    expect(deriveNotice(banner, bannerSettings)).toMatchObject({
      kind: "direct",
      mode: "banner",
    });
    expect(deriveNotice(ineligible, bannerSettings)).toBeNull();
    expect(updateRedirectUrl(ineligible, "https://final.example/", false).eligible.direct).toBe(
      false,
    );
  });

  it("keeps a dismissed category hidden for the current navigation", () => {
    const content = applyDetection(start(), "content", headerMatch, "cdn.example");
    const dismissed = dismissNotice(content.state, "content");
    const repeated = applyDetection(dismissed, "content", ipMatch, "assets.example");

    expect(deriveNotice(dismissed)).toBeNull();
    expect(deriveNotice(repeated.state)).toBeNull();
    expect(repeated.state.dismissed).toEqual({ direct: false, content: true });

    const direct = applyDetection(repeated.state, "direct", ipMatch);
    expect(deriveNotice(direct.state)).toMatchObject({ kind: "direct" });
    expect(deriveNotice(dismissNotice(direct.state, "direct"))).toBeNull();
  });

  it("disables only the selected category for the rest of the navigation", () => {
    const content = applyDetection(start(), "content", headerMatch, "cdn.example").state;
    const disabled = disableCategory(content, "content");

    expect(disabled.eligible).toEqual({ direct: true, content: false });
    expect(deriveNotice(disabled)).toBeNull();
    expect(content.eligible.content).toBe(true);
  });

  it("permanently suppresses notices for the navigation without suppressing detection counts", () => {
    const suppressed = suppressNavigation(start());
    const content = applyDetection(suppressed, "content", headerMatch, "cdn.example");
    const direct = applyDetection(content.state, "direct", ipMatch);

    expect(content.shouldCount).toBe(true);
    expect(direct.shouldCount).toBe(true);
    expect(direct.state.suppressedForNavigation).toBe(true);
    expect(deriveNotice(direct.state)).toBeNull();
  });
});
