import { describe, expect, it } from "vitest";
// @ts-expect-error The release CLI is an executable .mjs module without a declaration file.
import { inspectManifest } from "./verify-package.mjs";

const manifest = {
  manifest_version: 3,
  permissions: ["storage", "tabs", "webRequest"],
  action: { default_popup: "popup.html" },
  options_ui: { page: "options.html" },
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [{ matches: ["*://*/*"], js: ["content.js"] }],
};

describe("inspectManifest", () => {
  it("accepts the generated Cloudwatcher manifest shape", () => {
    expect(inspectManifest(manifest)).toEqual([]);
  });

  it("accepts Firefox's generated background scripts entry", () => {
    expect(
      inspectManifest({
        ...manifest,
        background: { scripts: ["background.js"] },
      }),
    ).toEqual([]);
  });

  it("reports required permissions that are missing", () => {
    expect(inspectManifest({ ...manifest, permissions: ["storage", "tabs"] })).toEqual([
      'missing required permission "webRequest"',
    ]);
  });

  it("reports unexpected permissions", () => {
    expect(
      inspectManifest({ ...manifest, permissions: [...manifest.permissions, "cookies"] }),
    ).toEqual(['unexpected permission "cookies"']);
  });

  it("reports a manifest that is not MV3", () => {
    expect(inspectManifest({ ...manifest, manifest_version: 2 })).toEqual([
      "manifest_version must be 3",
    ]);
  });

  it("reports missing popup, options, background, and content entries", () => {
    expect(
      inspectManifest({
        ...manifest,
        action: {},
        options_ui: {},
        background: {},
        content_scripts: [],
      }),
    ).toEqual([
      "missing action.default_popup",
      "missing options_ui.page",
      "missing background.service_worker",
      "missing content_scripts JavaScript entry",
    ]);
  });

  it.each([
    "http://example.test/script.js",
    "https://example.test/script.js",
    "//example.test/script.js",
  ])("reports remote script source %s", (source) => {
    expect(
      inspectManifest({
        ...manifest,
        content_scripts: [{ matches: ["*://*/*"], js: [source] }],
      }),
    ).toEqual([`remote source in content_scripts[0].js[0]: ${source}`]);
  });
});
