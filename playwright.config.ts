import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "node e2e/fixture-server.mjs",
    url: "http://127.0.0.1:4173/plain",
    reuseExistingServer: false,
  },
});
