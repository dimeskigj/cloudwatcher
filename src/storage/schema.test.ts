import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../core/model";
import {
  readIgnoreRules,
  readIpRanges,
  readOptionsSnapshot,
  readSettings,
  readSummaries,
  SCHEMA_VERSION,
} from "./schema";

describe("storage schema", () => {
  it("uses schema version 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("reads valid settings", () => {
    expect(readSettings({ directNoticeMode: "overlay", contentNoticeMode: "banner" })).toEqual({
      value: DEFAULT_SETTINGS,
      diagnostic: undefined,
    });
  });

  it("falls back to default settings and diagnoses an invalid record", () => {
    expect(readSettings({ directNoticeMode: "loud" })).toEqual({
      value: DEFAULT_SETTINGS,
      diagnostic: {
        section: "settings",
        message: expect.any(String),
      },
    });
  });

  it("rejects settings with extra keys", () => {
    expect(
      readSettings({
        directNoticeMode: "overlay",
        contentNoticeMode: "banner",
        unexpected: true,
      }),
    ).toEqual({
      value: DEFAULT_SETTINGS,
      diagnostic: {
        section: "settings",
        message: expect.any(String),
      },
    });
  });

  it("keeps valid ignore rules when sibling rows are invalid", () => {
    expect(
      readIgnoreRules([
        { scope: "host", value: "api.example.com" },
        { scope: "domain", value: "broken.example" },
        null,
        { scope: "site", value: "example.com" },
      ]),
    ).toEqual({
      value: [
        { scope: "host", value: "api.example.com" },
        { scope: "site", value: "example.com" },
      ],
      diagnostic: {
        section: "ignoreRules",
        message: expect.any(String),
      },
    });
  });

  it("rejects noncanonical, payload, and extra-key ignore rules", () => {
    expect(
      readIgnoreRules([
        { scope: "host", value: "api.example.com" },
        { scope: "host", value: "API.Example.COM" },
        { scope: "host", value: "https://example.com" },
        { scope: "site", value: "example.com/path" },
        { scope: "site", value: "example.com", unexpected: true },
      ]),
    ).toEqual({
      value: [{ scope: "host", value: "api.example.com" }],
      diagnostic: {
        section: "ignoreRules",
        message: expect.any(String),
      },
    });
  });

  it("keeps valid range rows and diagnoses invalid siblings", () => {
    expect(
      readIpRanges(["192.0.2.99/24", "not-a-cidr", 42, "192.0.2.0/24", "2001:0db8::/32"]),
    ).toEqual({
      value: ["192.0.2.0/24", "2001:db8::/32"],
      diagnostic: {
        section: "ipRanges",
        message: expect.any(String),
      },
    });
  });

  it("canonicalizes and deduplicates valid stored ranges", () => {
    expect(readIpRanges(["192.0.2.99/24", "192.0.2.0/24", "2001:0DB8::/32"])).toEqual({
      value: ["192.0.2.0/24", "2001:db8::/32"],
      diagnostic: undefined,
    });
  });

  it("uses an empty effective range list when no stored row is usable", () => {
    expect(readIpRanges(["", "not-a-cidr", null])).toEqual({
      value: [],
      diagnostic: {
        section: "ipRanges",
        message: expect.any(String),
      },
    });
  });

  it("uses an empty effective range list for an invalid top-level value", () => {
    expect(readIpRanges({ value: "104.16.0.0/13" })).toEqual({
      value: [],
      diagnostic: {
        section: "ipRanges",
        message: expect.any(String),
      },
    });
  });

  it("keeps valid summaries when sibling rows are invalid", () => {
    expect(
      readSummaries({
        "example.com": {
          directNavigations: 2,
          contentNavigations: 1,
          lastSeenAt: "2026-08-18T12:00:00.000Z",
        },
        broken: { directNavigations: -1 },
        "fractional.example": {
          directNavigations: 0.5,
          contentNavigations: 0,
          lastSeenAt: "2026-08-18T12:00:00.000Z",
        },
        "bad-date.example": {
          directNavigations: 0,
          contentNavigations: 1,
          lastSeenAt: "yesterday",
        },
      }),
    ).toEqual({
      value: {
        "example.com": {
          directNavigations: 2,
          contentNavigations: 1,
          lastSeenAt: "2026-08-18T12:00:00.000Z",
        },
      },
      diagnostic: {
        section: "summaries",
        message: expect.any(String),
      },
    });
  });

  it("rejects noncanonical or payload keys and extra summary fields", () => {
    const summary = {
      directNavigations: 1,
      contentNavigations: 0,
      lastSeenAt: "2026-08-18T12:00:00.000Z",
    };

    const result = readSummaries({
      "example.com": summary,
      "EXAMPLE.COM": summary,
      "https://example.com": summary,
      "example.com/path": summary,
      "extra.example": { ...summary, unexpected: true },
    });

    expect(result).toEqual({
      value: { "example.com": summary },
      diagnostic: {
        section: "summaries",
        message: expect.any(String),
      },
    });
    expect(Object.getPrototypeOf(result.value)).toBeNull();
  });

  it("retains own constructor and __proto__ summary keys in a null-prototype map", () => {
    const stored = Object.create(null) as Record<string, unknown>;
    const constructorKey: string = "constructor";
    const protoKey: string = "__proto__";
    stored[constructorKey] = {
      directNavigations: 1,
      contentNavigations: 0,
      lastSeenAt: "2026-08-18T12:00:00.000Z",
    };
    stored[protoKey] = {
      directNavigations: 0,
      contentNavigations: 2,
      lastSeenAt: "2026-08-18T12:01:00.000Z",
    };

    const result = readSummaries(stored);

    expect(result.diagnostic).toBeUndefined();
    expect(Object.getPrototypeOf(result.value)).toBeNull();
    expect(Object.hasOwn(result.value, constructorKey)).toBe(true);
    expect(Object.hasOwn(result.value, protoKey)).toBe(true);
    expect(result.value[constructorKey]?.directNavigations).toBe(1);
    expect(result.value[protoKey]?.contentNavigations).toBe(2);
  });

  it("aggregates valid sections without diagnostics", () => {
    expect(
      readOptionsSnapshot({
        schemaVersion: SCHEMA_VERSION,
        settings: DEFAULT_SETTINGS,
        ignoreRules: [{ scope: "site", value: "example.com" }],
        ipRanges: ["104.16.0.0/13"],
        summaries: {
          "example.com": {
            directNavigations: 1,
            contentNavigations: 0,
            lastSeenAt: "2026-08-18T12:00:00.000Z",
          },
        },
      }),
    ).toEqual({
      settings: DEFAULT_SETTINGS,
      ignoreRules: [{ scope: "site", value: "example.com" }],
      ipRanges: ["104.16.0.0/13"],
      summaries: {
        "example.com": {
          directNavigations: 1,
          contentNavigations: 0,
          lastSeenAt: "2026-08-18T12:00:00.000Z",
        },
      },
      diagnostics: [],
    });
  });

  it("reports each invalid section independently", () => {
    const snapshot = readOptionsSnapshot({
      schemaVersion: SCHEMA_VERSION,
      settings: null,
      ignoreRules: "example.com",
      ipRanges: null,
      summaries: [],
    });

    expect(snapshot).toMatchObject({
      settings: DEFAULT_SETTINGS,
      ignoreRules: [],
      ipRanges: [],
      summaries: {},
    });
    expect(snapshot.diagnostics.map(({ section }) => section)).toEqual([
      "settings",
      "ignoreRules",
      "ipRanges",
      "summaries",
    ]);
  });
});
