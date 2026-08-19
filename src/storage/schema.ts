import { compileCidrs } from "../core/cidr";
import {
  DEFAULT_SETTINGS,
  type DomainSummary,
  type IgnoreRule,
  type OptionsSnapshot,
  type Settings,
  type StorageDiagnostic,
  type StorageSection,
} from "../core/model";
import { canonicalizeHostname } from "../core/site-identity";

export const SCHEMA_VERSION = 1;

export interface SchemaRead<T> {
  value: T;
  diagnostic: StorageDiagnostic | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function diagnostic(section: StorageSection): StorageDiagnostic {
  return {
    section,
    message: `Stored ${section} data is invalid. Reset or replace this section to repair it.`,
  };
}

function isSettings(value: unknown): value is Settings {
  return (
    hasExactKeys(value, ["directNoticeMode", "contentNoticeMode"]) &&
    (value.directNoticeMode === "overlay" ||
      value.directNoticeMode === "banner" ||
      value.directNoticeMode === "off") &&
    (value.contentNoticeMode === "banner" || value.contentNoticeMode === "off")
  );
}

function isIgnoreRule(value: unknown): value is IgnoreRule {
  return (
    hasExactKeys(value, ["scope", "value"]) &&
    (value.scope === "host" || value.scope === "site") &&
    typeof value.value === "string" &&
    isCanonicalHostname(value.value)
  );
}

function isCanonicalHostname(value: string): boolean {
  try {
    return canonicalizeHostname(value) === value;
  } catch {
    return false;
  }
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
    hasExactKeys(value, ["directNavigations", "contentNavigations", "lastSeenAt"]) &&
    Number.isSafeInteger(value.directNavigations) &&
    Number(value.directNavigations) >= 0 &&
    Number.isSafeInteger(value.contentNavigations) &&
    Number(value.contentNavigations) >= 0 &&
    isIsoTimestamp(value.lastSeenAt)
  );
}

export function readSettings(value: unknown): SchemaRead<Settings> {
  if (isSettings(value)) {
    return {
      value: {
        directNoticeMode: value.directNoticeMode,
        contentNoticeMode: value.contentNoticeMode,
      },
      diagnostic: undefined,
    };
  }

  return {
    value: {
      directNoticeMode: DEFAULT_SETTINGS.directNoticeMode,
      contentNoticeMode: DEFAULT_SETTINGS.contentNoticeMode,
    },
    diagnostic: diagnostic("settings"),
  };
}

export function readIgnoreRules(value: unknown): SchemaRead<IgnoreRule[]> {
  if (!Array.isArray(value)) {
    return { value: [], diagnostic: diagnostic("ignoreRules") };
  }

  const validRules: IgnoreRule[] = [];
  let hasInvalidRule = false;

  for (const rule of value) {
    if (isIgnoreRule(rule)) {
      validRules.push({ scope: rule.scope, value: rule.value });
    } else {
      hasInvalidRule = true;
    }
  }

  return {
    value: validRules,
    diagnostic: hasInvalidRule ? diagnostic("ignoreRules") : undefined,
  };
}

export function readIpRanges(value: unknown): SchemaRead<string[]> {
  if (!Array.isArray(value)) {
    return { value: [], diagnostic: diagnostic("ipRanges") };
  }

  const validRanges = new Map<string, string>();
  let hasInvalidRange = false;

  for (const range of value) {
    if (typeof range !== "string") {
      hasInvalidRange = true;
      continue;
    }

    try {
      const compiled = compileCidrs([range]);
      const canonicalRange = compiled[0]?.text;

      if (canonicalRange === undefined) {
        hasInvalidRange = true;
      } else {
        validRanges.set(canonicalRange, canonicalRange);
      }
    } catch {
      hasInvalidRange = true;
    }
  }

  return {
    value: [...validRanges.values()],
    diagnostic: hasInvalidRange ? diagnostic("ipRanges") : undefined,
  };
}

export function readSummaries(value: unknown): SchemaRead<Record<string, DomainSummary>> {
  if (!isRecord(value)) {
    return {
      value: Object.create(null) as Record<string, DomainSummary>,
      diagnostic: diagnostic("summaries"),
    };
  }

  const summaries = Object.create(null) as Record<string, DomainSummary>;
  let hasInvalidSummary = false;

  for (const [siteKey, summary] of Object.entries(value)) {
    if (isCanonicalHostname(siteKey) && isDomainSummary(summary)) {
      summaries[siteKey] = {
        directNavigations: summary.directNavigations,
        contentNavigations: summary.contentNavigations,
        lastSeenAt: summary.lastSeenAt,
      };
    } else {
      hasInvalidSummary = true;
    }
  }

  return {
    value: summaries,
    diagnostic: hasInvalidSummary ? diagnostic("summaries") : undefined,
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
