import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { dismissNotice, startNavigation } from "../background/navigation-state";
import type { NavigationState } from "../core/model";
import { DEFAULT_SETTINGS } from "../core/model";
import { SessionNavigationStore } from "./session-navigation-store";

function navigation(tabId: number): NavigationState {
  return startNavigation({
    tabId,
    requestId: `request-${tabId}`,
    url: `https://tab-${tabId}.example/`,
    incognito: false,
    settings: DEFAULT_SETTINGS,
    ignoreRules: [],
    navigationId: `navigation-${tabId}`,
  });
}

function requireState(state: NavigationState | undefined): NavigationState {
  if (state === undefined) {
    throw new Error("Expected navigation state");
  }

  return state;
}

describe("SessionNavigationStore", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("round trips navigation state under a prefixed session key and returns callback values", async () => {
    await fakeBrowser.storage.local.set({ sentinel: "local-only" });
    const store = new SessionNavigationStore(fakeBrowser.storage.session);
    const state = navigation(4);

    await expect(
      store.update(4, async (current) => {
        expect(current).toBeUndefined();
        return { state, value: "saved" };
      }),
    ).resolves.toBe("saved");

    await expect(store.get(4)).resolves.toEqual(state);
    expect(await fakeBrowser.storage.session.get(null)).toEqual({ "navigation:4": state });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ sentinel: "local-only" });
  });

  it("lists only navigation entries and removes one tab without disturbing another", async () => {
    const store = new SessionNavigationStore(fakeBrowser.storage.session);
    const first = navigation(4);
    const second = navigation(7);
    await fakeBrowser.storage.session.set({
      unrelated: "preserve",
      "navigation:4": first,
      "navigation:7": second,
    });

    await expect(store.list()).resolves.toEqual([first, second]);
    await store.remove(4);

    await expect(store.get(4)).resolves.toBeUndefined();
    await expect(store.get(7)).resolves.toEqual(second);
    await expect(store.list()).resolves.toEqual([second]);
    expect(await fakeBrowser.storage.session.get(null)).toEqual({
      unrelated: "preserve",
      "navigation:7": second,
    });
  });

  it("removes stored state when an update callback returns no replacement", async () => {
    const store = new SessionNavigationStore(fakeBrowser.storage.session);
    const state = navigation(4);
    await fakeBrowser.storage.session.set({ "navigation:4": state });

    await expect(
      store.update(4, async (current) => ({
        value: requireState(current).navigationId,
      })),
    ).resolves.toBe("navigation-4");

    await expect(store.get(4)).resolves.toBeUndefined();
  });

  it("waits for an in-flight same-tab update before removing its state", async () => {
    const store = new SessionNavigationStore(fakeBrowser.storage.session);
    await fakeBrowser.storage.session.set({ "navigation:4": navigation(4) });
    let releaseUpdate: () => void = () => undefined;
    const updateCanFinish = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let markUpdateStarted: () => void = () => undefined;
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve;
    });
    let removalFinished = false;

    const update = store.update(4, async (current) => {
      markUpdateStarted();
      await updateCanFinish;
      return { state: dismissNotice(requireState(current), "direct"), value: "updated" };
    });
    await updateStarted;
    const removal = store.remove(4).then(() => {
      removalFinished = true;
    });

    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(removalFinished).toBe(false);
    } finally {
      releaseUpdate();
    }

    await expect(Promise.all([update, removal])).resolves.toEqual(["updated", undefined]);
    await expect(store.get(4)).resolves.toBeUndefined();
  });

  it("serializes concurrent updates to one tab without losing either mutation", async () => {
    const store = new SessionNavigationStore(fakeBrowser.storage.session);
    await fakeBrowser.storage.session.set({ "navigation:4": navigation(4) });
    let releaseFirst: () => void = () => undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let secondStarted = false;

    const firstUpdate = store.update(4, async (current) => {
      markFirstStarted();
      await firstCanFinish;
      return {
        state: dismissNotice(requireState(current), "direct"),
        value: "first",
      };
    });
    const secondUpdate = store.update(4, async (current) => {
      secondStarted = true;
      return {
        state: dismissNotice(requireState(current), "content"),
        value: "second",
      };
    });

    await firstStarted;
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst();

    await expect(Promise.all([firstUpdate, secondUpdate])).resolves.toEqual(["first", "second"]);
    await expect(store.get(4)).resolves.toMatchObject({
      dismissed: { direct: true, content: true },
    });
  });

  it("allows an update for another tab to finish while one tab is blocked", async () => {
    const store = new SessionNavigationStore(fakeBrowser.storage.session);
    let releaseBlocked: () => void = () => undefined;
    const canFinish = new Promise<void>((resolve) => {
      releaseBlocked = resolve;
    });
    let markBlockedStarted: () => void = () => undefined;
    const blockedStarted = new Promise<void>((resolve) => {
      markBlockedStarted = resolve;
    });
    let independentStarted = false;

    const blocked = store.update(4, async () => {
      markBlockedStarted();
      await canFinish;
      return { state: navigation(4), value: "blocked" };
    });
    await blockedStarted;
    const independent = store.update(7, async () => {
      independentStarted = true;
      return { state: navigation(7), value: "independent" };
    });

    try {
      await vi.waitFor(() => expect(independentStarted).toBe(true), { timeout: 500 });
      await expect(independent).resolves.toBe("independent");
    } finally {
      releaseBlocked();
    }

    await expect(blocked).resolves.toBe("blocked");
    await expect(store.list()).resolves.toEqual([navigation(4), navigation(7)]);
  });
});
