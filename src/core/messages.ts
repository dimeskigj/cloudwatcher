import type { CidrError } from "./cidr";
import type {
  DetectionEvidence,
  DomainSummary,
  IgnoreRule,
  NoticeState,
  Settings,
  StorageSection,
} from "./model";

export type RuntimeRequest =
  | { type: "content/handshake"; url: string }
  | { type: "notice/continue"; navigationId: string }
  | { type: "notice/ignore"; navigationId: string; rule: IgnoreRule }
  | { type: "notice/leave"; navigationId: string }
  | { type: "popup/get"; tabId: number }
  | { type: "options/get" }
  | { type: "options/update-settings"; settings: Settings }
  | { type: "options/remove-ignore"; rule: IgnoreRule }
  | { type: "options/save-ranges"; draft: string }
  | { type: "options/clear-activity" }
  | { type: "options/reset-section"; section: StorageSection };

export interface HandshakeData {
  navigationId: string | null;
  notice: NoticeState | null;
}

export interface PopupState {
  status: "direct" | "content" | "none" | "unavailable";
  ignored: boolean;
  hostname?: string;
  contentHost?: string;
  evidence: DetectionEvidence[];
  summary?: DomainSummary;
}

export type RuntimePush = {
  type: "notice/update";
  navigationId: string;
  notice: NoticeState | null;
};

export type RuntimeResponse<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; validationErrors?: CidrError[] };
