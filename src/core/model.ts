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

export interface DomainSummary {
  directNavigations: number;
  contentNavigations: number;
  lastSeenAt: string;
}
