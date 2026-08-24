import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The release CLI is an executable .mjs module without a declaration file.
import { inspectArtifact, inspectManifest } from "./verify-package.mjs";

const packageManifest = {
  manifest_version: 3,
  permissions: ["storage", "tabs", "webRequest"],
  host_permissions: ["*://*/*"],
  action: { default_popup: "popup.html" },
  options_ui: { page: "options.html" },
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [{ matches: ["*://*/*"], js: ["content.js"] }],
};

describe("inspectManifest", () => {
  it("accepts the generated Cloudwatcher manifest shape", () => {
    expect(inspectManifest(packageManifest, "chrome")).toEqual([]);
  });

  it("accepts Firefox's generated background scripts entry", () => {
    expect(
      inspectManifest(
        {
          ...packageManifest,
          background: { scripts: ["background.js"] },
        },
        "firefox",
      ),
    ).toEqual([]);
  });

  it("reports required permissions that are missing", () => {
    expect(
      inspectManifest({ ...packageManifest, permissions: ["storage", "tabs"] }, "chrome"),
    ).toEqual(['missing required permission "webRequest"']);
  });

  it("reports unexpected permissions", () => {
    expect(
      inspectManifest(
        {
          ...packageManifest,
          permissions: [...packageManifest.permissions, "cookies"],
        },
        "chrome",
      ),
    ).toEqual(['unexpected permission "cookies"']);
  });

  it("reports unexpected host permissions", () => {
    expect(
      inspectManifest(
        { ...packageManifest, host_permissions: ["*://*/*", "https://example.test/*"] },
        "chrome",
      ),
    ).toEqual(['unexpected host permission "https://example.test/*"']);
  });

  it("reports a manifest that is not MV3", () => {
    expect(inspectManifest({ ...packageManifest, manifest_version: 2 }, "chrome")).toEqual([
      "manifest_version must be 3",
    ]);
  });

  it("reports missing popup, options, background, and content entries", () => {
    expect(
      inspectManifest(
        {
          ...packageManifest,
          action: {},
          options_ui: {},
          background: {},
          content_scripts: [],
        },
        "chrome",
      ),
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
        ...packageManifest,
        content_scripts: [{ matches: ["*://*/*"], js: [source] }],
      }),
    ).toEqual([`remote source in content_scripts[0].js[0]: ${source}`]);
  });
});

describe("inspectArtifact", () => {
  function createArtifact(browser: "chrome" | "firefox", source = "") {
    const directory = mkdtempSync(join(tmpdir(), "cloudwatcher-package-"));
    const artifactManifest = {
      ...packageManifest,
      content_scripts: [{ matches: ["*://*/*"], js: ["content-scripts/cloudwatcher.js"] }],
      background:
        browser === "chrome" ? { service_worker: "background.js" } : { scripts: ["background.js"] },
    };

    mkdirSync(join(directory, "content-scripts"));
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(artifactManifest));
    writeFileSync(join(directory, "popup.html"), source);
    writeFileSync(join(directory, "options.html"), "");
    writeFileSync(join(directory, "background.js"), source);
    writeFileSync(join(directory, "content-scripts", "cloudwatcher.js"), source);

    return {
      directory,
      cleanup: () => rmSync(directory, { recursive: true, force: true }),
    };
  }

  it("rejects a Firefox background in a Chrome artifact", () => {
    const artifact = createArtifact("chrome");
    writeFileSync(
      join(artifact.directory, "manifest.json"),
      JSON.stringify({ ...packageManifest, background: { scripts: ["background.js"] } }),
    );

    try {
      expect(inspectArtifact("chrome", artifact.directory)).toContain(
        "chrome: missing background.service_worker",
      );
    } finally {
      artifact.cleanup();
    }
  });

  it("rejects a Chrome background in a Firefox artifact", () => {
    const artifact = createArtifact("firefox");
    writeFileSync(
      join(artifact.directory, "manifest.json"),
      JSON.stringify({ ...packageManifest, background: { service_worker: "background.js" } }),
    );

    try {
      expect(inspectArtifact("firefox", artifact.directory)).toContain(
        "firefox: missing background.scripts",
      );
    } finally {
      artifact.cleanup();
    }
  });

  it.each([
    [
      "chrome",
      { service_worker: "background.js", scripts: ["background.js"] },
      "background.scripts",
    ],
    [
      "firefox",
      { service_worker: "background.js", scripts: ["background.js"] },
      "background.service_worker",
    ],
  ] as const)(
    "rejects an unexpected background field in a %s artifact",
    (browser, background, field) => {
      const artifact = createArtifact(browser);
      writeFileSync(
        join(artifact.directory, "manifest.json"),
        JSON.stringify({ ...packageManifest, background }),
      );

      try {
        expect(inspectArtifact(browser, artifact.directory)).toContain(
          `${browser}: unexpected ${field}`,
        );
      } finally {
        artifact.cleanup();
      }
    },
  );

  it.each(["chrome", "firefox"] as const)("accepts a valid %s artifact", (browser) => {
    const artifact = createArtifact(browser);

    try {
      expect(inspectArtifact(browser, artifact.directory)).toEqual([]);
    } finally {
      artifact.cleanup();
    }
  });

  it("rejects missing and traversal manifest assets", () => {
    const artifact = createArtifact("chrome");
    writeFileSync(
      join(artifact.directory, "manifest.json"),
      JSON.stringify({
        ...packageManifest,
        action: { default_popup: "missing.html" },
        options_ui: { page: "../options.html" },
      }),
    );

    try {
      expect(inspectArtifact("chrome", artifact.directory)).toEqual(
        expect.arrayContaining([
          "chrome: missing asset action.default_popup: missing.html",
          "chrome: invalid asset options_ui.page: ../options.html",
        ]),
      );
    } finally {
      artifact.cleanup();
    }
  });

  it("detects executable remote script and import sources", () => {
    const artifact = createArtifact(
      "chrome",
      '<script data-note=">"><!-- --></script><script src="https://example.test/script.js"></script>\nimport value from /* note */ "https://example.test/module.js";\nimport("//example.test/dynamic.js");\nexport { value } from "http://example.test/re-export.js";',
    );

    try {
      expect(inspectArtifact("chrome", artifact.directory)).toEqual(
        expect.arrayContaining([
          "chrome: remote script/import in popup.html",
          "chrome: remote script/import in background.js",
          "chrome: remote script/import in content-scripts/cloudwatcher.js",
        ]),
      );
    } finally {
      artifact.cleanup();
    }
  });

  it("ignores remote-looking text in comments and strings", () => {
    const artifact = createArtifact(
      "chrome",
      '// import "https://example.test/comment.js"\nconst documentation = \'import "https://example.test/string.js"\';\n<!-- <script src="https://example.test/comment.js"></script> -->',
    );

    try {
      expect(inspectArtifact("chrome", artifact.directory)).toEqual([]);
    } finally {
      artifact.cleanup();
    }
  });

  it("ignores imports in non-executable HTML script types", () => {
    const artifact = createArtifact("chrome");
    writeFileSync(
      join(artifact.directory, "popup.html"),
      '<script type="text/plain">import "https://example.test/module.js";</script>',
    );

    try {
      expect(inspectArtifact("chrome", artifact.directory)).toEqual([]);
    } finally {
      artifact.cleanup();
    }
  });
});
