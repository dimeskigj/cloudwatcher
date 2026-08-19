export type DirectNoticeMode = "overlay" | "banner" | "off";
export type ContentNoticeMode = "banner" | "off";
export type DetectionCategory = "direct" | "content";

export type DetectionEvidence =
  | {
      kind: "header";
      signal: "cf-ray" | "cf-cache-status" | "cf-mitigated" | "server: cloudflare";
    }
  | { kind: "ip"; ip: string; cidr: string };

export interface DetectionMatch {
  evidence: DetectionEvidence[];
}

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

export interface NavigationState {
  tabId: number;
  requestId: string;
  navigationId: string;
  topLevelUrl: string;
  identity: SiteIdentity;
  incognito: boolean;
  direct?: { match: DetectionMatch };
  content?: { match: DetectionMatch; resourceHost: string };
  counted: Record<DetectionCategory, boolean>;
  dismissed: Record<DetectionCategory, boolean>;
  eligible: Record<DetectionCategory, boolean>;
  suppressedForNavigation: boolean;
}

export interface NoticeState {
  navigationId: string;
  kind: DetectionCategory;
  mode: "overlay" | "banner";
  siteHost: string;
  resourceHost?: string;
  evidence: DetectionEvidence[];
  ignoreChoices: IgnoreChoice[];
}

export interface DomainSummary {
  directNavigations: number;
  contentNavigations: number;
  lastSeenAt: string;
}

export type StorageSection = "settings" | "ignoreRules" | "ipRanges" | "summaries";

export interface StorageDiagnostic {
  section: StorageSection;
  message: string;
}

export interface OptionsSnapshot {
  settings: Settings;
  ignoreRules: IgnoreRule[];
  ipRanges: string[];
  summaries: Record<string, DomainSummary>;
  diagnostics: StorageDiagnostic[];
}
