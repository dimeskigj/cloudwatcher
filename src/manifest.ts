export const manifestConfig = {
  name: "Cloudwatcher",
  description: "See when a site or page content is served through Cloudflare.",
  permissions: ["storage", "tabs", "webRequest"],
  host_permissions: ["*://*/*"],
  browser_specific_settings: {
    gecko: {
      id: "{9cf420ab-247d-4d7b-8827-b0dabc55bb7b}",
      data_collection_permissions: {
        required: ["none"],
      },
    },
  },
} as const;
