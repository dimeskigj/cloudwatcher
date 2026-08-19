import { DEFAULT_CIDRS } from "../core/default-ranges";
import {
  DEFAULT_SETTINGS,
  type DetectionCategory,
  type DomainSummary,
  type IgnoreRule,
  type OptionsSnapshot,
  type Settings,
  type StorageSection,
} from "../core/model";
import { canonicalizeHostname } from "../core/site-identity";
import {
  readIgnoreRules,
  readIpRanges,
  readOptionsSnapshot,
  readSettings,
  readSummaries,
  SCHEMA_VERSION,
  type SchemaRead,
} from "./schema";

const STORAGE_KEYS = ["schemaVersion", "settings", "ignoreRules", "ipRanges", "summaries"] as const;

type ResetValue = Settings | IgnoreRule[] | string[] | Record<string, DomainSummary>;

export interface StorageAreaLike {
  get(keys?: null | string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(snapshotInput);
  }

  if (!isRecord(value)) {
    return value;
  }

  const snapshot = Object.create(null) as Record<string, unknown>;

  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    snapshot[key] =
      descriptor !== undefined && "value" in descriptor
        ? snapshotInput(descriptor.value)
        : undefined;
  }

  return snapshot;
}

function settingsDefault(): Settings {
  return {
    directNoticeMode: DEFAULT_SETTINGS.directNoticeMode,
    contentNoticeMode: DEFAULT_SETTINGS.contentNoticeMode,
  };
}

function emptySummaries(): Record<string, DomainSummary> {
  return Object.create(null) as Record<string, DomainSummary>;
}

function initialStorage(): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: settingsDefault(),
    ignoreRules: [],
    ipRanges: Array.from(DEFAULT_CIDRS),
    summaries: emptySummaries(),
  };
}

function requireValid<T>(result: SchemaRead<T>, section: StorageSection): T {
  if (result.diagnostic !== undefined) {
    throw new Error(`Cannot update ${section}: ${result.diagnostic.message}`);
  }

  return result.value;
}

function canonicalizeRule(value: unknown): IgnoreRule {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "scope") ||
    !Object.hasOwn(value, "value") ||
    (value.scope !== "host" && value.scope !== "site") ||
    typeof value.value !== "string"
  ) {
    throw new Error("Cannot store an invalid ignore rule");
  }

  return { scope: value.scope, value: canonicalizeHostname(value.value) };
}

function deduplicateRules(rules: readonly IgnoreRule[]): IgnoreRule[] {
  const seen = new Set<string>();
  const uniqueRules: IgnoreRule[] = [];

  for (const rule of rules) {
    const key = `${rule.scope}\0${rule.value}`;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueRules.push({ scope: rule.scope, value: rule.value });
    }
  }

  return uniqueRules;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Detection timestamp must be a valid ISO timestamp");
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Detection timestamp must be a valid ISO timestamp");
  }

  return timestamp.toISOString();
}

function defaultForSection(section: StorageSection): ResetValue {
  switch (section) {
    case "settings":
      return settingsDefault();
    case "ignoreRules":
      return [];
    case "ipRanges":
      return Array.from(DEFAULT_CIDRS);
    case "summaries":
      return emptySummaries();
    default:
      throw new Error("Unknown storage section");
  }
}

function copySummaries(
  summaries: Readonly<Record<string, DomainSummary>>,
): Record<string, DomainSummary> {
  const replacement = emptySummaries();

  for (const [siteKey, summary] of Object.entries(summaries)) {
    replacement[siteKey] = {
      directNavigations: summary.directNavigations,
      contentNavigations: summary.contentNavigations,
      lastSeenAt: summary.lastSeenAt,
    };
  }

  return replacement;
}

export class LocalRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly local: StorageAreaLike) {}

  initialize(): Promise<void> {
    return this.enqueue(async () => {
      const stored = await this.local.get("schemaVersion");

      if (stored.schemaVersion === undefined) {
        await this.local.set(initialStorage());
      }
    });
  }

  async getOptionsSnapshot(): Promise<OptionsSnapshot> {
    await this.writeQueue;
    const stored = await this.local.get([...STORAGE_KEYS]);
    return readOptionsSnapshot(stored);
  }

  updateSettings(settings: Settings): Promise<Settings> {
    const input = snapshotInput(settings);

    return this.enqueue(async () => {
      await this.local.get("settings");
      const replacement = requireValid(readSettings(input), "settings");
      await this.local.set({ settings: replacement });
      return replacement;
    });
  }

  addIgnoreRule(rule: IgnoreRule): Promise<IgnoreRule[]> {
    const input = snapshotInput(rule);

    return this.enqueue(async () => {
      const stored = await this.local.get("ignoreRules");
      const rules = requireValid(readIgnoreRules(stored.ignoreRules), "ignoreRules");
      const canonicalRule = canonicalizeRule(input);
      const replacement = deduplicateRules(rules.concat(canonicalRule));
      await this.local.set({ ignoreRules: replacement });
      return replacement;
    });
  }

  removeIgnoreRule(rule: IgnoreRule): Promise<IgnoreRule[]> {
    const input = snapshotInput(rule);

    return this.enqueue(async () => {
      const stored = await this.local.get("ignoreRules");
      const rules = requireValid(readIgnoreRules(stored.ignoreRules), "ignoreRules");
      const canonicalRule = canonicalizeRule(input);
      const replacement = deduplicateRules(rules).filter(
        (candidate) =>
          candidate.scope !== canonicalRule.scope || candidate.value !== canonicalRule.value,
      );
      await this.local.set({ ignoreRules: replacement });
      return replacement;
    });
  }

  saveRanges(ranges: readonly string[]): Promise<string[]> {
    const input = snapshotInput(ranges);

    return this.enqueue(async () => {
      await this.local.get("ipRanges");
      const replacement = requireValid(readIpRanges(input), "ipRanges");
      await this.local.set({ ipRanges: replacement });
      return replacement;
    });
  }

  recordDetection(
    siteKey: string,
    category: DetectionCategory,
    seenAt: string,
  ): Promise<DomainSummary> {
    const siteKeyInput = siteKey;
    const categoryInput = category;
    const timestampInput = seenAt;

    return this.enqueue(async () => {
      const stored = await this.local.get("summaries");
      const summaries = requireValid(readSummaries(stored.summaries), "summaries");
      const canonicalSiteKey = canonicalizeHostname(siteKeyInput);
      const timestamp = normalizeTimestamp(timestampInput);

      if (categoryInput !== "direct" && categoryInput !== "content") {
        throw new Error("Detection category must be direct or content");
      }

      const current = Object.hasOwn(summaries, canonicalSiteKey)
        ? summaries[canonicalSiteKey]
        : undefined;
      const directNavigations = current?.directNavigations ?? 0;
      const contentNavigations = current?.contentNavigations ?? 0;

      if (
        (categoryInput === "direct" && directNavigations === Number.MAX_SAFE_INTEGER) ||
        (categoryInput === "content" && contentNavigations === Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error(
          `Cannot increment ${categoryInput} detection count beyond the safe integer limit`,
        );
      }

      const summary: DomainSummary = {
        directNavigations: directNavigations + (categoryInput === "direct" ? 1 : 0),
        contentNavigations: contentNavigations + (categoryInput === "content" ? 1 : 0),
        lastSeenAt:
          current === undefined || timestamp > current.lastSeenAt ? timestamp : current.lastSeenAt,
      };
      const replacement = copySummaries(summaries);
      replacement[canonicalSiteKey] = {
        directNavigations: summary.directNavigations,
        contentNavigations: summary.contentNavigations,
        lastSeenAt: summary.lastSeenAt,
      };
      await this.local.set({ summaries: replacement });
      return summary;
    });
  }

  clearActivity(): Promise<Record<string, DomainSummary>> {
    return this.enqueue(async () => {
      await this.local.get("summaries");
      const replacement = emptySummaries();
      await this.local.set({ summaries: replacement });
      return replacement;
    });
  }

  resetSection(section: StorageSection): Promise<ResetValue> {
    return this.enqueue(async () => {
      await this.local.get(section);
      const replacement = defaultForSection(section);
      await this.local.set({ [section]: replacement });
      return replacement;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
