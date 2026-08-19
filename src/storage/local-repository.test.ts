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

  it("replaces ranges atomically and permits an intentionally empty list", async () => {
    await seedVersionedStorage();
    const set = vi.spyOn(fakeBrowser.storage.local, "set");
    const repository = new LocalRepository(fakeBrowser.storage.local);

    await expect(repository.saveRanges([])).resolves.toEqual([]);

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ ipRanges: [] });
    expect((await repository.getOptionsSnapshot()).ipRanges).toEqual([]);
  });

  it("canonicalizes and deduplicates shared ignore rules", async () => {
    await seedVersionedStorage({
      ignoreRules: [
        { scope: "site", value: "Example.COM." },
        { scope: "site", value: "example.com" },
        { scope: "host", value: "example.com" },
      ],
    });
    const repository = new LocalRepository(fakeBrowser.storage.local);

    const [first, second] = await Promise.all([
      repository.addIgnoreRule({ scope: "host", value: "API.Example.COM." }),
      repository.addIgnoreRule({ scope: "host", value: "api.example.com" }),
    ]);

    expect(first).toEqual([
      { scope: "site", value: "example.com" },
      { scope: "host", value: "example.com" },
      { scope: "host", value: "api.example.com" },
    ]);
    expect(second).toEqual(first);
    await expect(
      repository.removeIgnoreRule({ scope: "site", value: "EXAMPLE.COM." }),
    ).resolves.toEqual([
      { scope: "host", value: "example.com" },
      { scope: "host", value: "api.example.com" },
    ]);
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

  it("leaves private detections unrecorded at the caller boundary", async () => {
    await seedVersionedStorage();
    const repository = new LocalRepository(fakeBrowser.storage.local);
    const recordFromCaller = async (incognito: boolean): Promise<void> => {
      if (!incognito) {
        await repository.recordDetection("example.com", "direct", "2026-08-18T12:00:00.000Z");
      }
    };

    await recordFromCaller(true);

    expect((await repository.getOptionsSnapshot()).summaries).toEqual({});
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
