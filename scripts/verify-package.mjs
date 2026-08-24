import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";

const requiredPermissions = ["storage", "tabs", "webRequest"];
const requiredHostPermissions = ["*://*/*"];
const remoteSource = /^(?:https?:)?\/\//i;

export function inspectManifest(manifest, browser) {
  const violations = [];
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];

  if (manifest.manifest_version !== 3) {
    violations.push("manifest_version must be 3");
  }

  for (const permission of requiredPermissions) {
    if (!permissions.includes(permission)) {
      violations.push(`missing required permission "${permission}"`);
    }
  }

  for (const permission of permissions) {
    if (!requiredPermissions.includes(permission)) {
      violations.push(`unexpected permission "${permission}"`);
    }
  }

  for (const permission of requiredHostPermissions) {
    if (!hostPermissions.includes(permission)) {
      violations.push(`missing required host permission "${permission}"`);
    }
  }

  for (const permission of hostPermissions) {
    if (!requiredHostPermissions.includes(permission)) {
      violations.push(`unexpected host permission "${permission}"`);
    }
  }

  if (typeof manifest.action?.default_popup !== "string" || !manifest.action.default_popup) {
    violations.push("missing action.default_popup");
  }
  if (typeof manifest.options_ui?.page !== "string" || !manifest.options_ui.page) {
    violations.push("missing options_ui.page");
  }
  const backgroundScripts = Array.isArray(manifest.background?.scripts)
    ? manifest.background.scripts
    : [];
  if (browser === "chrome" && typeof manifest.background?.service_worker !== "string") {
    violations.push("missing background.service_worker");
  }
  if (browser === "chrome" && manifest.background?.scripts !== undefined) {
    violations.push("unexpected background.scripts");
  }
  if (browser === "firefox" && backgroundScripts.length === 0) {
    violations.push("missing background.scripts");
  }
  if (browser === "firefox" && manifest.background?.service_worker !== undefined) {
    violations.push("unexpected background.service_worker");
  }

  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  if (!contentScripts.some((entry) => Array.isArray(entry.js) && entry.js.length > 0)) {
    violations.push("missing content_scripts JavaScript entry");
  }

  const sources = [
    ["background.service_worker", manifest.background?.service_worker],
    ...backgroundScripts.map((source, sourceIndex) => [
      `background.scripts[${sourceIndex}]`,
      source,
    ]),
    ...contentScripts.flatMap((entry, entryIndex) =>
      (Array.isArray(entry.js) ? entry.js : []).map((source, sourceIndex) => [
        `content_scripts[${entryIndex}].js[${sourceIndex}]`,
        source,
      ]),
    ),
  ];
  for (const [location, source] of sources) {
    if (typeof source === "string" && remoteSource.test(source)) {
      violations.push(`remote source in ${location}: ${source}`);
    }
  }

  return violations;
}

function hasRemoteImport(source) {
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const next = () => scanner.scan();
  const remoteString = () => remoteSource.test(scanner.getTokenValue());

  for (let token = next(); token !== SyntaxKind.EndOfFile; token = next()) {
    if (token !== SyntaxKind.ImportKeyword && token !== SyntaxKind.ExportKeyword) continue;

    token = next();
    if (token === SyntaxKind.StringLiteral && remoteString()) return true;
    if (token === SyntaxKind.OpenParenToken) {
      if (next() === SyntaxKind.StringLiteral && remoteString()) return true;
      continue;
    }

    while (token !== SyntaxKind.EndOfFile && token !== SyntaxKind.SemicolonToken) {
      if (token === SyntaxKind.FromKeyword) {
        if (next() === SyntaxKind.StringLiteral && remoteString()) return true;
        break;
      }
      token = next();
    }
  }

  return false;
}

function hasRemoteSource(path, source) {
  if (/\.html$/i.test(path)) {
    const document = new JSDOM(source).window.document;
    return [...document.querySelectorAll("script")].some((script) => {
      const type = script.getAttribute("type")?.trim().toLowerCase();
      const executable =
        !type ||
        type === "module" ||
        /^(?:application|text)\/(?:javascript|ecmascript)$/.test(type);
      return (
        executable &&
        (remoteSource.test(script.getAttribute("src") ?? "") ||
          hasRemoteImport(script.textContent ?? ""))
      );
    });
  }
  return hasRemoteImport(source);
}

function manifestSources(manifest, browser) {
  const backgroundScripts = Array.isArray(manifest.background?.scripts)
    ? manifest.background.scripts
    : [];
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  return [
    ["action.default_popup", manifest.action?.default_popup],
    ["options_ui.page", manifest.options_ui?.page],
    ...(browser === "chrome"
      ? [["background.service_worker", manifest.background?.service_worker]]
      : backgroundScripts.map((source, index) => [`background.scripts[${index}]`, source])),
    ...contentScripts.flatMap((entry, entryIndex) =>
      (Array.isArray(entry.js) ? entry.js : []).map((source, sourceIndex) => [
        `content_scripts[${entryIndex}].js[${sourceIndex}]`,
        source,
      ]),
    ),
  ];
}

function inspectAsset(directory, location, source) {
  if (typeof source !== "string" || !source || remoteSource.test(source)) {
    return `invalid asset ${location}: ${source}`;
  }
  const path = resolve(directory, source);
  const artifactPath = relative(directory, path);
  if (isAbsolute(source) || artifactPath === ".." || artifactPath.startsWith(`..${sep}`)) {
    return `invalid asset ${location}: ${source}`;
  }
  if (!existsSync(path)) {
    return `missing asset ${location}: ${source}`;
  }
  return null;
}

function textFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return /\.(?:[cm]?js|html)$/i.test(entry.name) ? [path] : [];
  });
}

export function inspectArtifact(browser, directory = `.output/${browser}-mv3`) {
  const violations = [];
  const manifestPath = join(directory, "manifest.json");

  if (!existsSync(manifestPath)) {
    return [`${browser}: missing generated manifest at ${manifestPath}`];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  violations.push(
    ...inspectManifest(manifest, browser).map((violation) => `${browser}: ${violation}`),
  );
  for (const [location, source] of manifestSources(manifest, browser)) {
    const violation = inspectAsset(directory, location, source);
    if (violation) violations.push(`${browser}: ${violation}`);
  }

  for (const path of textFiles(directory)) {
    const source = readFileSync(path, "utf8");
    if (hasRemoteSource(path, source)) {
      violations.push(`${browser}: remote script/import in ${relative(directory, path)}`);
    }
  }

  return violations;
}

function main() {
  const violations = ["chrome", "firefox"].flatMap((browser) => inspectArtifact(browser));
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
    return;
  }

  for (const browser of ["chrome", "firefox"]) {
    console.log(`${browser}: package verified`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
