import { describe, expect, it } from "vitest";
import { manifestConfig } from "./manifest";

describe("manifestConfig", () => {
  it("requests only the APIs and hosts needed for passive detection", () => {
    expect(manifestConfig.permissions).toEqual(["storage", "tabs", "webRequest"]);
    expect(manifestConfig.host_permissions).toEqual(["*://*/*"]);
    expect(manifestConfig.name).toBe("Cloudwatcher");
    expect(manifestConfig.description).toContain("Cloudflare");
  });

  it("declares a stable Firefox extension ID", () => {
    expect(manifestConfig.browser_specific_settings?.gecko?.id).toBe(
      "{9cf420ab-247d-4d7b-8827-b0dabc55bb7b}",
    );
  });

  it("declares that Firefox data collection is not required", () => {
    expect(
      manifestConfig.browser_specific_settings?.gecko?.data_collection_permissions?.required,
    ).toEqual(["none"]);
  });
});
