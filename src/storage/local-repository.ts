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

function initialStorage(): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    ignoreRules: [],
    ipRanges: [...DEFAULT_CIDRS],
    summaries: {},
  };
}

function requireValid<T>(result: SchemaRead<T>, section: StorageSection): T {
  if (result.diagnostic !== undefined) {
    throw new Error(`Cannot update ${section}: ${result.diagnostic.message}`);
  }

  return result.value;
}

function canonicalizeRule(rule: IgnoreRule): IgnoreRule {
  let value = rule.value.trim().toLowerCase().replace(/\.+$/, "");

  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }

  if (value.length === 0) {
    throw new Error("Cannot store an ignore rule with an empty value");
  }

  return { scope: rule.scope, value };
}

function canonicalizeRules(rules: readonly IgnoreRule[]): IgnoreRule[] {
  const seen = new Set<string>();
  const canonicalRules: IgnoreRule[] = [];

  for (const rule of rules) {
    const canonicalRule = canonicalizeRule(rule);
    const key = `${canonicalRule.scope}\0${canonicalRule.value}`;

    if (!seen.has(key)) {
      seen.add(key);
      canonicalRules.push(canonicalRule);
    }
  }

  return canonicalRules;
}

function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Detection timestamp must be a valid ISO timestamp");
  }

  return timestamp.toISOString();
}

function defaultForSection(section: StorageSection): ResetValue {
  switch (section) {
    case "settings":
      return { ...DEFAULT_SETTINGS };
    case "ignoreRules":
      return [];
    case "ipRanges":
      return [...DEFAULT_CIDRS];
    case "summaries":
      return {};
  }
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
    const replacement = { ...settings };
    requireValid(readSettings(replacement), "settings");

    return this.enqueue(async () => {
      await this.local.get("settings");
      await this.local.set({ settings: replacement });
      return replacement;
    });
  }

  addIgnoreRule(rule: IgnoreRule): Promise<IgnoreRule[]> {
    const canonicalRule = canonicalizeRule(rule);

    return this.enqueue(async () => {
      const stored = await this.local.get("ignoreRules");
      const rules = requireValid(readIgnoreRules(stored.ignoreRules), "ignoreRules");
      const replacement = canonicalizeRules([...rules, canonicalRule]);
      await this.local.set({ ignoreRules: replacement });
      return replacement;
    });
  }

  removeIgnoreRule(rule: IgnoreRule): Promise<IgnoreRule[]> {
    const canonicalRule = canonicalizeRule(rule);

    return this.enqueue(async () => {
      const stored = await this.local.get("ignoreRules");
      const rules = requireValid(readIgnoreRules(stored.ignoreRules), "ignoreRules");
      const replacement = canonicalizeRules(rules).filter(
        (candidate) =>
          candidate.scope !== canonicalRule.scope || candidate.value !== canonicalRule.value,
      );
      await this.local.set({ ignoreRules: replacement });
      return replacement;
    });
  }

  saveRanges(ranges: readonly string[]): Promise<string[]> {
    const replacement = [...ranges];
    requireValid(readIpRanges(replacement), "ipRanges");

    return this.enqueue(async () => {
      await this.local.get("ipRanges");
      await this.local.set({ ipRanges: replacement });
      return replacement;
    });
  }

  recordDetection(
    siteKey: string,
    category: DetectionCategory,
    seenAt: string,
  ): Promise<DomainSummary> {
    const timestamp = normalizeTimestamp(seenAt);

    if (siteKey.length === 0) {
      return Promise.reject(new Error("Detection site key must not be empty"));
    }

    return this.enqueue(async () => {
      const stored = await this.local.get("summaries");
      const summaries = requireValid(readSummaries(stored.summaries), "summaries");
      const current = summaries[siteKey];
      const directNavigations = current?.directNavigations ?? 0;
      const contentNavigations = current?.contentNavigations ?? 0;

      if (
        (category === "direct" && directNavigations === Number.MAX_SAFE_INTEGER) ||
        (category === "content" && contentNavigations === Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error(
          `Cannot increment ${category} detection count beyond the safe integer limit`,
        );
      }

      const summary: DomainSummary = {
        directNavigations: directNavigations + (category === "direct" ? 1 : 0),
        contentNavigations: contentNavigations + (category === "content" ? 1 : 0),
        lastSeenAt:
          current === undefined || timestamp > current.lastSeenAt ? timestamp : current.lastSeenAt,
      };
      const replacement = { ...summaries, [siteKey]: summary };
      await this.local.set({ summaries: replacement });
      return summary;
    });
  }

  clearActivity(): Promise<Record<string, DomainSummary>> {
    return this.enqueue(async () => {
      await this.local.get("summaries");
      const replacement: Record<string, DomainSummary> = {};
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
