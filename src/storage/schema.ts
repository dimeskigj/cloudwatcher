import {
  DEFAULT_SETTINGS,
  type DomainSummary,
  type IgnoreRule,
  type OptionsSnapshot,
  type Settings,
  type StorageDiagnostic,
  type StorageSection,
} from "../core/model";

export const SCHEMA_VERSION = 1;

export interface SchemaRead<T> {
  value: T;
  diagnostic: StorageDiagnostic | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(section: StorageSection): StorageDiagnostic {
  return {
    section,
    message: `Stored ${section} data is invalid. Reset or replace this section to repair it.`,
  };
}

function isSettings(value: unknown): value is Settings {
  return (
    isRecord(value) &&
    (value.directNoticeMode === "overlay" ||
      value.directNoticeMode === "banner" ||
      value.directNoticeMode === "off") &&
    (value.contentNoticeMode === "banner" || value.contentNoticeMode === "off")
  );
}

function isIgnoreRule(value: unknown): value is IgnoreRule {
  return (
    isRecord(value) &&
    (value.scope === "host" || value.scope === "site") &&
    typeof value.value === "string" &&
    value.value.length > 0
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isDomainSummary(value: unknown): value is DomainSummary {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.directNavigations) &&
    Number(value.directNavigations) >= 0 &&
    Number.isSafeInteger(value.contentNavigations) &&
    Number(value.contentNavigations) >= 0 &&
    isIsoTimestamp(value.lastSeenAt)
  );
}

export function readSettings(value: unknown): SchemaRead<Settings> {
  if (isSettings(value)) {
    return { value, diagnostic: undefined };
  }

  return { value: { ...DEFAULT_SETTINGS }, diagnostic: diagnostic("settings") };
}

export function readIgnoreRules(value: unknown): SchemaRead<IgnoreRule[]> {
  if (!Array.isArray(value)) {
    return { value: [], diagnostic: diagnostic("ignoreRules") };
  }

  const validRules = value.filter(isIgnoreRule);
  return {
    value: validRules,
    diagnostic: validRules.length === value.length ? undefined : diagnostic("ignoreRules"),
  };
}

export function readIpRanges(value: unknown): SchemaRead<string[]> {
  if (!Array.isArray(value)) {
    return { value: [], diagnostic: diagnostic("ipRanges") };
  }

  const validRanges = value.filter((range): range is string => typeof range === "string");
  return {
    value: validRanges,
    diagnostic: validRanges.length === value.length ? undefined : diagnostic("ipRanges"),
  };
}

export function readSummaries(value: unknown): SchemaRead<Record<string, DomainSummary>> {
  if (!isRecord(value)) {
    return { value: {}, diagnostic: diagnostic("summaries") };
  }

  const entries = Object.entries(value);
  const validEntries = entries.filter(
    (entry): entry is [string, DomainSummary] => entry[0].length > 0 && isDomainSummary(entry[1]),
  );

  return {
    value: Object.fromEntries(validEntries),
    diagnostic: validEntries.length === entries.length ? undefined : diagnostic("summaries"),
  };
}

export function readOptionsSnapshot(stored: Record<string, unknown>): OptionsSnapshot {
  const settings = readSettings(stored.settings);
  const ignoreRules = readIgnoreRules(stored.ignoreRules);
  const ipRanges = readIpRanges(stored.ipRanges);
  const summaries = readSummaries(stored.summaries);
  const diagnostics = [
    settings.diagnostic,
    ignoreRules.diagnostic,
    ipRanges.diagnostic,
    summaries.diagnostic,
  ].filter((item): item is StorageDiagnostic => item !== undefined);

  return {
    settings: settings.value,
    ignoreRules: ignoreRules.value,
    ipRanges: ipRanges.value,
    summaries: summaries.value,
    diagnostics,
  };
}
