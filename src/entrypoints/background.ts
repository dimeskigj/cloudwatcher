import { createBrowserAdapter } from "@/background/browser-adapter";
import { BackgroundController } from "@/background/controller";
import { LocalRepository } from "@/storage/local-repository";
import { SessionNavigationStore } from "@/storage/session-navigation-store";

function logBackgroundError(error: unknown): void {
  console.error("Cloudwatcher background handler failed.", error);
}

export default defineBackground(() => {
  const repository = new LocalRepository(browser.storage.local);
  const navigationStore = new SessionNavigationStore(browser.storage.session);
  const controller = new BackgroundController(repository, navigationStore, createBrowserAdapter());
  const ready = controller.initialize();

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      void ready.then(() => controller.handleBeforeRequest(details)).catch(logBackgroundError);
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
  );
  browser.webRequest.onResponseStarted.addListener(
    (details) => {
      void ready.then(() => controller.handleResponseStarted(details)).catch(logBackgroundError);
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"],
  );
  browser.runtime.onMessage.addListener((message, sender) =>
    ready.then(() => controller.handleMessage(message, sender)),
  );
  browser.tabs.onRemoved.addListener((tabId) => {
    void controller.handleTabRemoved(tabId).catch(logBackgroundError);
  });
});
