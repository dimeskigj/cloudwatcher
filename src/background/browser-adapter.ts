import type { RuntimePush } from "../core/messages";

export interface BrowserAdapter {
  sendNotice(tabId: number, message: RuntimePush): Promise<void>;
  getTabUrl(tabId: number): Promise<string | undefined>;
  goBack(tabId: number): Promise<void>;
  replaceWithBlank(tabId: number): Promise<void>;
}

interface BrowserFacade {
  tabs: {
    sendMessage(tabId: number, message: RuntimePush): Promise<unknown>;
    get(tabId: number): Promise<{ url?: string }>;
    goBack(tabId: number): Promise<void>;
    update(tabId: number, updateProperties: { url: string }): Promise<unknown>;
  };
}

export function createBrowserAdapter(facade: BrowserFacade = browser): BrowserAdapter {
  return {
    async sendNotice(tabId, message) {
      try {
        await facade.tabs.sendMessage(tabId, message);
      } catch {
        // A page may not have a content-script receiver; the session state remains available.
      }
    },

    async getTabUrl(tabId) {
      try {
        return (await facade.tabs.get(tabId)).url;
      } catch {
        return undefined;
      }
    },

    goBack(tabId) {
      return facade.tabs.goBack(tabId);
    },

    async replaceWithBlank(tabId) {
      await facade.tabs.update(tabId, { url: "about:blank" });
    },
  };
}
