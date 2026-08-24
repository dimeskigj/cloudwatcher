import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "**/node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
    restoreMocks: true,
  },
});
