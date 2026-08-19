export type DirectNoticeMode = "overlay" | "banner" | "off";
export type ContentNoticeMode = "banner" | "off";
export type DetectionCategory = "direct" | "content";

export interface Settings {
  directNoticeMode: DirectNoticeMode;
  contentNoticeMode: ContentNoticeMode;
}

export const DEFAULT_SETTINGS: Settings = {
  directNoticeMode: "overlay",
  contentNoticeMode: "banner",
};

export interface IgnoreRule {
  scope: "host" | "site";
  value: string;
}

export interface IgnoreChoice {
  label: string;
  rule: IgnoreRule;
}

export interface SiteIdentity {
  hostname: string;
  siteKey: string;
  registrableDomain?: string;
}

export interface DomainSummary {
  directNavigations: number;
  contentNavigations: number;
  lastSeenAt: string;
}
