import { describe, expect, it } from "vitest";
import { manifestConfig } from "./manifest";

describe("manifestConfig", () => {
  it("requests only the APIs and hosts needed for passive detection", () => {
    expect(manifestConfig.permissions).toEqual(["storage", "tabs", "webRequest"]);
    expect(manifestConfig.host_permissions).toEqual(["*://*/*"]);
    expect(manifestConfig.name).toBe("Cloudwatcher");
    expect(manifestConfig.description).toContain("Cloudflare");
  });
});
