import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_CIDRS } from "../core/default-ranges";
import { DEFAULT_SETTINGS, type Settings, type StorageSection } from "../core/model";
import { LocalRepository } from "./local-repository";
import { SCHEMA_VERSION } from "./schema";

const customSettings: Settings = {
  directNoticeMode: "banner",
  contentNoticeMode: "off",
};

async function seedVersionedStorage(overrides: Record<string, unknown> = {}): Promise<void> {
  await fakeBrowser.storage.local.set({
    schemaVersion: SCHEMA_VERSION,
    settings: DEFAULT_SETTINGS,
    ignoreRules: [],
    ipRanges: [...DEFAULT_CIDRS],
    summaries: {},
    ...overrides,
  });
}

describe("LocalRepository", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("seeds all version 1 defaults on first install", async () => {
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await repository.initialize();

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      settings: DEFAULT_SETTINGS,
      ignoreRules: [],
      ipRanges: [...DEFAULT_CIDRS],
      summaries: {},
    });
    expect((await repository.getOptionsSnapshot()).ipRanges).toEqual([...DEFAULT_CIDRS]);
  });

  it("seeds every key when the version is absent even if partial data remains", async () => {
    await fakeBrowser.storage.local.set({
      settings: customSettings,
      ipRanges: ["192.0.2.0/24"],
      unrelated: "keep",
    });
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await repository.initialize();

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      settings: DEFAULT_SETTINGS,
      ignoreRules: [],
      ipRanges: [...DEFAULT_CIDRS],
      summaries: {},
      unrelated: "keep",
    });
  });

  it("does not seed or repair storage after a schema version exists", async () => {
    await fakeBrowser.storage.local.set({
      schemaVersion: SCHEMA_VERSION,
      settings: customSettings,
      ipRanges: "invalid but preserved",
    });
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await repository.initialize();

    expect(set).not.toHaveBeenCalled();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      settings: customSettings,
      ipRanges: "invalid but preserved",
    });
  });

  it("reports invalid data without writing over its raw source", async () => {
    const rawRules = [
      { scope: "host", value: "valid.example" },
      { scope: "domain", value: "broken.example" },
    ];
    await seedVersionedStorage({ ignoreRules: rawRules });
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    const snapshot = await repository.getOptionsSnapshot();

    expect(snapshot.ignoreRules).toEqual([{ scope: "host", value: "valid.example" }]);
    expect(snapshot.diagnostics).toEqual([{ section: "ignoreRules", message: expect.any(String) }]);
    expect(set).not.toHaveBeenCalled();
    expect((await fakeBrowser.storage.local.get("ignoreRules")).ignoreRules).toEqual(rawRules);
  });

  it("replaces settings with one atomic section write", async () => {
    await seedVersionedStorage();
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const remove = vi.spyOn(fakeBrowser.storage.local, "remove");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(repository.updateSettings(customSettings)).resolves.toEqual(customSettings);

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ settings: customSettings });
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects extra settings keys asynchronously and keeps the queue usable", async () => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);
    const invalidSettings = {
      ...customSettings,
      unexpected: true,
    } as Settings;
    let rejection: Promise<Settings> | undefined;

    expect(() => {
      rejection = repository.updateSettings(invalidSettings);
    }).not.toThrow();
    await expect(rejection).rejects.toThrow(/settings/);
    expect((await fakeBrowser.storage.local.get("settings")).settings).toEqual(DEFAULT_SETTINGS);
    await expect(repository.updateSettings(customSettings)).resolves.toEqual(customSettings);
  });

  it("replaces ranges atomically and permits an intentionally empty list", async () => {
    await seedVersionedStorage();
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(repository.saveRanges([])).resolves.toEqual([]);

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ ipRanges: [] });
    expect((await repository.getOptionsSnapshot()).ipRanges).toEqual([]);
  });

  it("canonicalizes and deduplicates a complete range replacement atomically", async () => {
    await seedVersionedStorage();
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(
      repository.saveRanges(["192.0.2.99/24", "192.0.2.0/24", "2001:0DB8::/32"]),
    ).resolves.toEqual(["192.0.2.0/24", "2001:db8::/32"]);

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ ipRanges: ["192.0.2.0/24", "2001:db8::/32"] });
  });

  it("rejects a complete range replacement asynchronously when any entry is invalid", async () => {
    await seedVersionedStorage({ ipRanges: ["192.0.2.0/24"] });
    const repository = new LocalRepository(fakeBrowser.storage.local);
    let rejection: Promise<string[]> | undefined;

    expect(() => {
      rejection = repository.saveRanges(["198.51.100.0/24", "not-a-cidr"]);
    }).not.toThrow();
    await expect(rejection).rejects.toThrow(/ipRanges/);
    expect((await fakeBrowser.storage.local.get("ipRanges")).ipRanges).toEqual(["192.0.2.0/24"]);
    await expect(repository.saveRanges(["198.51.100.9/24"])).resolves.toEqual(["198.51.100.0/24"]);
  });

  it("canonicalizes and deduplicates shared ignore rules", async () => {
    await seedVersionedStorage({
      ignoreRules: [
        { scope: "site", value: "example.com" },
        { scope: "site", value: "example.com" },
        { scope: "host", value: "example.com" },
      ],
    });
    const repository = new LocalRepository(fakeBrowser.storage.local);

    const [first, second] = await Promise.all([
      repository.addIgnoreRule({ scope: "host", value: "BÜCHER.Example." }),
      repository.addIgnoreRule({ scope: "host", value: "xn--bcher-kva.example" }),
    ]);

    expect(first).toEqual([
      { scope: "site", value: "example.com" },
      { scope: "host", value: "example.com" },
      { scope: "host", value: "xn--bcher-kva.example" },
    ]);
    expect(second).toEqual(first);
    await expect(
      repository.removeIgnoreRule({ scope: "site", value: "EXAMPLE.COM." }),
    ).resolves.toEqual([
      { scope: "host", value: "example.com" },
      { scope: "host", value: "xn--bcher-kva.example" },
    ]);
  });

  it.each([
    { scope: "host", value: "https://example.com" },
    { scope: "host", value: "example.com/path" },
    { scope: "host", value: "example.com:443" },
    { scope: "host", value: " example.com" },
    { scope: "host", value: "user@example.com" },
    { scope: "host", value: "example.com", unexpected: true },
  ])("rejects malformed ignore rule $value asynchronously", async (invalidRule) => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);
    let rejection: Promise<unknown> | undefined;

    expect(() => {
      rejection = repository.addIgnoreRule(invalidRule as never);
    }).not.toThrow();
    await expect(rejection).rejects.toThrow(/rule|hostname/i);
    expect((await fakeBrowser.storage.local.get("ignoreRules")).ignoreRules).toEqual([]);
  });

  it("rejects incremental rule changes when the raw section is invalid", async () => {
    const rawRules = [{ scope: "host", value: "valid.example" }, { value: "broken.example" }];
    await seedVersionedStorage({ ignoreRules: rawRules });
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(repository.addIgnoreRule({ scope: "site", value: "example.com" })).rejects.toThrow(
      /ignoreRules/,
    );
    await expect(
      repository.removeIgnoreRule({ scope: "host", value: "valid.example" }),
    ).rejects.toThrow(/ignoreRules/);
    expect((await fakeBrowser.storage.local.get("ignoreRules")).ignoreRules).toEqual(rawRules);
  });

  it("increments only the requested category and keeps the lexically latest ISO timestamp", async () => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await repository.recordDetection("example.com", "content", "2026-08-18T12:02:00.000Z");
    await repository.recordDetection("example.com", "direct", "2026-08-18T12:01:00.000Z");

    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toEqual({
      directNavigations: 1,
      contentNavigations: 1,
      lastSeenAt: "2026-08-18T12:02:00.000Z",
    });
  });

  it("serializes concurrent summary increments", async () => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await Promise.all([
      repository.recordDetection("example.com", "direct", "2026-08-18T12:00:00.000Z"),
      repository.recordDetection("example.com", "direct", "2026-08-18T12:01:00.000Z"),
    ]);

    expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toEqual({
      directNavigations: 2,
      contentNavigations: 0,
      lastSeenAt: "2026-08-18T12:01:00.000Z",
    });
  });

  it("canonicalizes IDNA summary keys", async () => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await repository.recordDetection("BÜCHER.Example.", "direct", "2026-08-18T12:00:00.000Z");

    const summaries = (await repository.getOptionsSnapshot()).summaries;
    expect(Object.getPrototypeOf(summaries)).toBeNull();
    expect(Object.hasOwn(summaries, "xn--bcher-kva.example")).toBe(true);
    expect(Object.hasOwn(summaries, "BÜCHER.Example.")).toBe(false);
  });

  it.each([
    "https://example.com",
    "example.com/path",
    "example.com:443",
    " example.com",
    "user@example.com",
  ])("rejects malformed summary key %s asynchronously", async (siteKey) => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);
    let rejection: Promise<unknown> | undefined;

    expect(() => {
      rejection = repository.recordDetection(siteKey, "direct", "2026-08-18T12:00:00.000Z");
    }).not.toThrow();
    await expect(rejection).rejects.toThrow(/hostname/i);
    expect((await fakeBrowser.storage.local.get("summaries")).summaries).toEqual({});
  });

  it("updates own constructor and __proto__ keys with null-prototype replacements", async () => {
    const summaries = Object.create(null) as Record<string, unknown>;
    const constructorKey: string = "constructor";
    const protoKey: string = "__proto__";
    summaries[constructorKey] = {
      directNavigations: 1,
      contentNavigations: 0,
      lastSeenAt: "2026-08-18T12:00:00.000Z",
    };
    summaries[protoKey] = {
      directNavigations: 0,
      contentNavigations: 2,
      lastSeenAt: "2026-08-18T12:01:00.000Z",
    };
    await seedVersionedStorage({ summaries });
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await repository.recordDetection("constructor", "direct", "2026-08-18T12:02:00.000Z");
    await repository.recordDetection("__proto__", "content", "2026-08-18T12:03:00.000Z");

    const snapshot = await repository.getOptionsSnapshot();
    const firstWrite = set.mock.calls[0]?.[0] as unknown as { summaries: object };
    const secondWrite = set.mock.calls[1]?.[0] as unknown as { summaries: object };
    expect(snapshot.summaries[constructorKey]?.directNavigations).toBe(2);
    expect(snapshot.summaries[protoKey]?.contentNavigations).toBe(3);
    expect(Object.getPrototypeOf(firstWrite.summaries)).toBeNull();
    expect(Object.getPrototypeOf(secondWrite.summaries)).toBeNull();
  });

  it("rejects an invalid timestamp asynchronously without poisoning the queue", async () => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);
    let rejection: Promise<unknown> | undefined;

    expect(() => {
      rejection = repository.recordDetection("example.com", "direct", "not-a-timestamp");
    }).not.toThrow();
    await expect(rejection).rejects.toThrow(/timestamp/i);
    await expect(
      repository.recordDetection("example.com", "direct", "2026-08-18T12:00:00.000Z"),
    ).resolves.toMatchObject({ directNavigations: 1 });
  });

  it("rejects summary increments when any raw summary row is invalid", async () => {
    const rawSummaries = {
      "example.com": {
        directNavigations: 1,
        contentNavigations: 0,
        lastSeenAt: "2026-08-18T12:00:00.000Z",
      },
      broken: { directNavigations: -1 },
    };
    await seedVersionedStorage({ summaries: rawSummaries });
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(
      repository.recordDetection("example.com", "direct", "2026-08-18T12:01:00.000Z"),
    ).rejects.toThrow(/summaries/);
    expect((await fakeBrowser.storage.local.get("summaries")).summaries).toEqual(rawSummaries);
  });

  it("clears activity without changing another section", async () => {
    await seedVersionedStorage({
      settings: customSettings,
      summaries: {
        "example.com": {
          directNavigations: 1,
          contentNavigations: 0,
          lastSeenAt: "2026-08-18T12:00:00.000Z",
        },
      },
    });
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(repository.clearActivity()).resolves.toEqual({});

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ summaries: {} });
    const write = set.mock.calls[0]?.[0] as unknown as { summaries: object };
    expect(Object.getPrototypeOf(write.summaries)).toBeNull();
    expect((await fakeBrowser.storage.local.get("settings")).settings).toEqual(customSettings);
  });

  it.each<[StorageSection, unknown]>([
    ["settings", DEFAULT_SETTINGS],
    ["ignoreRules", []],
    ["ipRanges", [...DEFAULT_CIDRS]],
    ["summaries", {}],
  ])("resets only the confirmed %s section", async (section, expectedValue) => {
    await seedVersionedStorage({
      settings: customSettings,
      ignoreRules: [{ scope: "host", value: "example.com" }],
      ipRanges: ["192.0.2.0/24"],
      summaries: {
        "example.com": {
          directNavigations: 1,
          contentNavigations: 2,
          lastSeenAt: "2026-08-18T12:00:00.000Z",
        },
      },
    });
    const before = await fakeBrowser.storage.local.get(null);
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(repository.resetSection(section)).resolves.toEqual(expectedValue);

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ [section]: expectedValue });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      ...before,
      [section]: expectedValue,
    });
  });

  it("uses explicit replacement to repair an invalid section", async () => {
    await seedVersionedStorage({ settings: { directNoticeMode: "loud" } });
    const repository = new LocalRepository(fakeBrowser.storage.local);

    expect((await repository.getOptionsSnapshot()).diagnostics[0]?.section).toBe("settings");
    await repository.updateSettings(customSettings);

    expect(await repository.getOptionsSnapshot()).toMatchObject({
      settings: customSettings,
      diagnostics: [],
    });
  });

  it("keeps the prior value when a storage write fails and continues the queue", async () => {
    await seedVersionedStorage();
    const set = vi
      .spyOn(fakeBrowser.storage.local, "set")
      .mockRejectedValueOnce(new Error("local storage unavailable"));
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(repository.updateSettings(customSettings)).rejects.toThrow(
      "local storage unavailable",
    );
    expect((await fakeBrowser.storage.local.get("settings")).settings).toEqual(DEFAULT_SETTINGS);

    await expect(repository.saveRanges(["192.0.2.0/24"])).resolves.toEqual(["192.0.2.0/24"]);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("keeps the prior summary when storage read or write fails", async () => {
    const priorSummary = {
      directNavigations: 1,
      contentNavigations: 0,
      lastSeenAt: "2026-08-18T12:00:00.000Z",
    };
    await seedVersionedStorage({ summaries: { "example.com": priorSummary } });
    const get = vi
      .spyOn(fakeBrowser.storage.local, "get")
      .mockRejectedValueOnce(new Error("read failed"));
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(
      repository.recordDetection("example.com", "direct", "2026-08-18T12:01:00.000Z"),
    ).rejects.toThrow("read failed");
    get.mockRestore();
    expect((await fakeBrowser.storage.local.get("summaries")).summaries).toEqual({
      "example.com": priorSummary,
    });

    const set = vi
      .spyOn(fakeBrowser.storage.local, "set")
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(
      repository.recordDetection("example.com", "direct", "2026-08-18T12:01:00.000Z"),
    ).rejects.toThrow("write failed");
    expect((await fakeBrowser.storage.local.get("summaries")).summaries).toEqual({
      "example.com": priorSummary,
    });
    expect(set).toHaveBeenCalledOnce();
  });
});
