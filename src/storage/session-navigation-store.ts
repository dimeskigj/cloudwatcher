import type { NavigationState } from "../core/model";
import type { StorageAreaLike } from "./local-repository";

const NAVIGATION_KEY_PREFIX = "navigation:";

function navigationKey(tabId: number): string {
  return `${NAVIGATION_KEY_PREFIX}${tabId}`;
}

export class SessionNavigationStore {
  private readonly locks = new Map<number, Promise<unknown>>();

  constructor(private readonly session: StorageAreaLike) {}

  async get(tabId: number): Promise<NavigationState | undefined> {
    const key = navigationKey(tabId);
    const stored = await this.session.get(key);
    return stored[key] as NavigationState | undefined;
  }

  async update<T>(
    tabId: number,
    callback: (
      current: NavigationState | undefined,
    ) => Promise<{ state?: NavigationState; value: T }>,
  ): Promise<T> {
    const prior = this.locks.get(tabId) ?? Promise.resolve();
    const operation = async (): Promise<T> => {
      const current = await this.get(tabId);
      const { state, value } = await callback(current);

      if (state === undefined) {
        await this.session.remove(navigationKey(tabId));
      } else {
        await this.session.set({ [navigationKey(tabId)]: state });
      }

      return value;
    };
    const result = prior.then(operation, operation);
    const lock = result.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(tabId, lock);
    void lock.then(() => {
      if (this.locks.get(tabId) === lock) {
        this.locks.delete(tabId);
      }
    });
    return result;
  }

  async remove(tabId: number): Promise<void> {
    await this.session.remove(navigationKey(tabId));
  }

  async list(): Promise<NavigationState[]> {
    const stored = await this.session.get(null);
    return Object.entries(stored)
      .filter(([key]) => key.startsWith(NAVIGATION_KEY_PREFIX))
      .map(([, state]) => state as NavigationState)
      .sort((left, right) => left.tabId - right.tabId);
  }
}
