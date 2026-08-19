import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";
import { manifestConfig } from "./src/manifest";

export default defineConfig({
  srcDir: "src",
  manifest: {
    ...manifestConfig,
    permissions: [...manifestConfig.permissions],
    host_permissions: [...manifestConfig.host_permissions],
    browser_specific_settings: {
      gecko: {
        ...manifestConfig.browser_specific_settings.gecko,
        data_collection_permissions: {
          required: [
            ...manifestConfig.browser_specific_settings.gecko.data_collection_permissions.required,
          ],
        },
      },
    },
  },
  vite: () => ({ plugins: [preact()] }),
});
