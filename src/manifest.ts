export const manifestConfig = {
  name: "Cloudwatcher",
  description: "See when a site or page content is served through Cloudflare.",
  permissions: ["storage", "tabs", "webRequest"],
  host_permissions: ["*://*/*"],
} as const;
