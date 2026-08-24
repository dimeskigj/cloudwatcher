import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const requiredPermissions = ["storage", "tabs", "webRequest"];
const remoteSource = /^(?:https?:)?\/\//i;
const remoteImport = /\bimport\s*(?:\(\s*|[\w*${}\s,]*?from\s*)?["'](?:https?:)?\/\//gi;
const remoteScript = /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//gi;

export function inspectManifest(manifest) {
  const violations = [];
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];

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

  if (typeof manifest.action?.default_popup !== "string") {
    violations.push("missing action.default_popup");
  }
  if (typeof manifest.options_ui?.page !== "string") {
    violations.push("missing options_ui.page");
  }
  const backgroundScripts = Array.isArray(manifest.background?.scripts)
    ? manifest.background.scripts
    : [];
  if (typeof manifest.background?.service_worker !== "string" && backgroundScripts.length === 0) {
    violations.push("missing background.service_worker");
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

function textFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return /\.(?:[cm]?js|html)$/i.test(entry.name) ? [path] : [];
  });
}

function inspectArtifact(browser) {
  const directory = `.output/${browser}-mv3`;
  const violations = [];
  const manifestPath = join(directory, "manifest.json");

  if (!existsSync(manifestPath)) {
    return [`${browser}: missing generated manifest at ${manifestPath}`];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  violations.push(...inspectManifest(manifest).map((violation) => `${browser}: ${violation}`));

  for (const path of textFiles(directory)) {
    const source = readFileSync(path, "utf8");
    const matches = [...source.matchAll(remoteImport), ...source.matchAll(remoteScript)];
    for (const _match of matches) {
      violations.push(`${browser}: remote script/import in ${relative(directory, path)}`);
    }
  }

  return violations;
}

function main() {
  const violations = ["chrome", "firefox"].flatMap(inspectArtifact);
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
