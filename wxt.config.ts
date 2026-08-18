import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";
import { manifestConfig } from "./src/manifest";

export default defineConfig({
  srcDir: "src",
  manifest: {
    ...manifestConfig,
    permissions: [...manifestConfig.permissions],
    host_permissions: [...manifestConfig.host_permissions],
  },
  vite: () => ({ plugins: [preact()] }),
});
