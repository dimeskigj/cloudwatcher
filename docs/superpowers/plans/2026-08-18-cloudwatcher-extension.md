# Cloudwatcher Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Firefox-first, Chromium-compatible extension that detects Cloudflare on top-level and subresource responses, presents configurable notices, and stores privacy-preserving local summaries.

**Architecture:** A WXT Manifest V3 background controller observes passive `webRequest` events and delegates classification to pure TypeScript modules. Session-backed navigation state coordinates a closed-Shadow-DOM content notice, while a typed runtime protocol serves the popup and options page. Persistent settings, shared ignore rules, managed CIDRs, and domain summaries pass through one serialized local repository.

**Tech Stack:** TypeScript 7, WXT 0.21, Preact 10, `tldts`, `ipaddr.js`, Vitest 4, Testing Library, Biome 2, Playwright, and `web-ext`.

## Global Constraints

- Produce Firefox MV3 and Chromium MV3 packages from one source tree; Firefox is the primary release target.
- Observe only passive response metadata; never block, redirect, or modify requests.
- Detection is positive when a strong Cloudflare header or a managed Cloudflare CIDR matches.
- Direct warning modes are `overlay`, `banner`, and `off`; the default is `overlay`.
- Content warning modes are `banner` and `off`; the default is `banner`.
- Direct detection suppresses the content banner even when direct warnings are off.
- Continue dismisses only the current network navigation.
- Permanent ignore rules are shared by both categories and offer exact host or registrable site plus all subdomains.
- Go back falls back to `about:blank` when browser history cannot be used.
- Warning suppression never disables detection or non-private summary counting.
- Persist only settings, ignore rules, managed CIDRs, per-site category counts, and last-seen timestamps in `storage.local`.
- Store current URLs, response evidence, server IPs, and navigation guards only in `storage.session`.
- Never persist private-window activity counts; an explicit permanent ignore from a private window may persist.
- Make no telemetry, external lookup, automatic range-update, settings-sync, or remote-code request.
- Describe negative state as "No Cloudflare observed," never as proof that Cloudflare is absent.
- Meet WCAG AA contrast, keyboard, focus, reduced-motion, 200% zoom, and narrow-viewport requirements.
- Support the current Firefox ESR plus current stable Firefox and Chromium at release time.

---

## File Structure

### Project And Build

- `package.json`: npm scripts and pinned dependency ranges.
- `package-lock.json`: reproducible npm dependency graph.
- `.gitignore`: generated WXT, test, package, and browser artifacts.
- `biome.json`: formatting and lint rules.
- `tsconfig.json`: WXT and Preact TypeScript settings.
- `vitest.config.ts`: WXT-aware unit and DOM test configuration.
- `vitest.setup.ts`: Testing Library cleanup and DOM matchers.
- `wxt.config.ts`: Preact Vite plugin and shared MV3 manifest metadata.
- `playwright.config.ts`: Chromium extension smoke-test configuration.

### Core Domain

- `src/manifest.ts`: final manifest permissions and product metadata.
- `src/core/model.ts`: settings, evidence, navigation, notice, popup, and options types.
- `src/core/site-identity.ts`: hostname canonicalization, public-suffix lookup, and ignore matching.
- `src/core/cidr.ts`: CIDR parsing, canonicalization, validation, compilation, and matching.
- `src/core/default-ranges.ts`: reviewed bundled Cloudflare IPv4/IPv6 ranges.
- `src/core/detection.ts`: strong-header and connected-IP Cloudflare classifier.
- `src/core/messages.ts`: runtime request and response union.

### Storage And Background

- `src/storage/schema.ts`: schema guards and diagnostics for persisted records.
- `src/storage/local-repository.ts`: serialized persistent reads and writes.
- `src/storage/session-navigation-store.ts`: per-tab session state and operation locks.
- `src/background/navigation-state.ts`: pure navigation and notice state transitions.
- `src/background/browser-adapter.ts`: minimal wrapper around tabs and runtime browser APIs.
- `src/background/controller.ts`: event orchestration, counting, settings changes, and message routing.
- `src/entrypoints/background.ts`: synchronous WebExtension listener registration.

### User Interfaces

- `src/ui/brand.tsx`: shared compact Cloudwatcher mark and wordmark.
- `src/ui/base.css`: extension-page color, typography, focus, and control tokens.
- `src/entrypoints/cloudwatcher.content/index.tsx`: handshake and closed Shadow DOM lifecycle.
- `src/entrypoints/cloudwatcher.content/Notice.tsx`: overlay/banner component and actions.
- `src/entrypoints/cloudwatcher.content/notice.css`: isolated notice styles.
- `src/entrypoints/popup/index.html`: toolbar popup document.
- `src/entrypoints/popup/main.tsx`: popup mount.
- `src/entrypoints/popup/App.tsx`: current-tab state and evidence UI.
- `src/entrypoints/popup/style.css`: compact popup layout.
- `src/entrypoints/options/index.html`: full-tab settings document.
- `src/entrypoints/options/main.tsx`: options mount.
- `src/entrypoints/options/App.tsx`: view navigation, loading, and mutations.
- `src/entrypoints/options/WarningsView.tsx`: direct/content mode controls.
- `src/entrypoints/options/IgnoredView.tsx`: shared ignore-rule list.
- `src/entrypoints/options/RangesView.tsx`: draft, validation, import, export, and reset.
- `src/entrypoints/options/ActivityView.tsx`: domain summary table and clear action.
- `src/entrypoints/options/style.css`: responsive options layout.

### Assets, Docs, And Verification

- `public/icon-source.svg`: source Cloudwatcher icon.
- `public/icon-{16,32,48,96,128}.png`: generated browser icons.
- `scripts/generate-icons.mjs`: deterministic SVG-to-PNG generation.
- `scripts/verify-package.mjs`: generated-manifest and remote-endpoint checks.
- `e2e/fixture-server.mjs`: local plain/direct/content test pages.
- `e2e/cloudwatcher.spec.ts`: Chromium unpacked-extension smoke tests.
- `docs/PRIVACY.md`: retained-data and permission explanation.
- `docs/STORE-LISTING.md`: store copy, permission rationale, limitations, and affiliation disclaimer.
- `docs/TESTING.md`: Firefox release smoke matrix and browser limitations.
- `README.md`: setup, development, build, and behavior guide.

Tests are colocated as `*.test.ts` or `*.test.tsx` beside the source they cover.

---

### Task 1: Cross-Browser Project Foundation

**Files:**
- Create: `.nvmrc`
- Create: `package.json`
- Create: `.gitignore`
- Create: `biome.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `wxt.config.ts`
- Create: `src/manifest.test.ts`
- Create: `src/manifest.ts`
- Create: `src/entrypoints/background.ts`
- Generate: `package-lock.json`

**Interfaces:**
- Produces: `manifestConfig`, the shared WXT manifest fragment used by every browser build.
- Produces: npm scripts `test`, `lint`, `typecheck`, `build:chrome`, `build:firefox`, and `build` used by all later tasks.

- [ ] **Step 1: Create the package and test harness, then write the failing manifest test**

Use this package metadata and scripts:

Pin the Node version in `.nvmrc`:

```text
26.7.0
```

```json
{
  "name": "cloudwatcher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "npm@11.9.0",
  "engines": { "node": ">=26" },
  "scripts": {
    "dev": "wxt -b chrome --mv3",
    "dev:firefox": "wxt -b firefox --mv3",
    "prepare": "wxt prepare",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "wxt prepare && tsc --noEmit",
    "build:chrome": "wxt build -b chrome --mv3",
    "build:firefox": "wxt build -b firefox --mv3",
    "build": "npm run build:chrome && npm run build:firefox"
  },
  "dependencies": {
    "ipaddr.js": "^2.5.0",
    "preact": "^10.29.8",
    "tldts": "^7.4.10"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.9",
    "@preact/preset-vite": "^2.10.6",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/preact": "^3.2.4",
    "@testing-library/user-event": "^14.6.5",
    "@types/node": "^26.2.0",
    "axe-core": "^4.13.0",
    "jsdom": "^30.0.1",
    "typescript": "^7.0.2",
    "vitest": "^4.1.11",
    "wxt": "^0.21.4"
  }
}
```

Use these exact test and TypeScript harness files:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    restoreMocks: true,
  },
});
```

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(cleanup);
```

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "noUncheckedIndexedAccess": true
  }
}
```

Create `biome.json` with this configuration:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.9/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "javascript": {
    "formatter": { "quoteStyle": "double" }
  }
}
```

Ignore these paths in `.gitignore`:

```gitignore
node_modules/
.output/
.wxt/
coverage/
playwright-report/
test-results/
web-ext-artifacts/
```

Do not create `wxt.config.ts` in this step because npm's `prepare` lifecycle must run before the deliberately missing manifest module exists. Write `src/manifest.test.ts` to assert the final name, description, permissions, and portable web-host pattern:

```ts
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
```

- [ ] **Step 2: Install dependencies and verify the test fails**

Run: `npm install && npm test -- src/manifest.test.ts`

Expected: FAIL because `src/manifest.ts` does not exist.

- [ ] **Step 3: Add the minimal manifest and WXT shell**

```ts
// src/manifest.ts
export const manifestConfig = {
  name: "Cloudwatcher",
  description: "See when a site or page content is served through Cloudflare.",
  permissions: ["storage", "tabs", "webRequest"],
  host_permissions: ["*://*/*"],
} as const;
```

```ts
// wxt.config.ts
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
```

```ts
// src/entrypoints/background.ts
export default defineBackground(() => undefined);
```

Use `npm run lint` as the acceptance check for the Biome configuration.

- [ ] **Step 4: Verify the foundation**

Run: `npm test -- src/manifest.test.ts && npm run typecheck && npm run build`

Expected: one passing test and successful `.output/chrome-mv3` and `.output/firefox-mv3` builds.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc package.json package-lock.json .gitignore biome.json tsconfig.json vitest.config.ts vitest.setup.ts wxt.config.ts src/manifest.ts src/manifest.test.ts src/entrypoints/background.ts
git commit -m "build: initialize cross-browser extension"
```

### Task 2: Site Identity And Ignore Rules

**Files:**
- Create: `src/core/model.ts`
- Create: `src/core/site-identity.ts`
- Create: `src/core/site-identity.test.ts`

**Interfaces:**
- Produces: `Settings`, `IgnoreRule`, `SiteIdentity`, and `DomainSummary`.
- Produces: `getSiteIdentity(url)`, `matchesIgnoreRule(hostname, rule)`, `isIgnored(identity, rules)`, and `getIgnoreChoices(identity)`.

- [ ] **Step 1: Write failing identity and rule tests**

Cover multi-label suffixes, private suffixes, exact-host rules, whole-site rules, localhost, IPv4, and bracketed IPv6:

```ts
expect(getSiteIdentity("https://shop.example.co.uk/cart")).toEqual({
  hostname: "shop.example.co.uk",
  siteKey: "example.co.uk",
  registrableDomain: "example.co.uk",
});
expect(getSiteIdentity("https://team.github.io/").siteKey).toBe("team.github.io");
expect(getSiteIdentity("http://localhost:3000/").siteKey).toBe("localhost");
expect(getIgnoreChoices(getSiteIdentity("https://shop.example.co.uk"))).toEqual([
  { label: "shop.example.co.uk only", rule: { scope: "host", value: "shop.example.co.uk" } },
  {
    label: "example.co.uk and all subdomains",
    rule: { scope: "site", value: "example.co.uk" },
  },
]);
expect(matchesIgnoreRule("api.example.co.uk", { scope: "site", value: "example.co.uk" })).toBe(true);
expect(matchesIgnoreRule("notexample.co.uk", { scope: "site", value: "example.co.uk" })).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- src/core/site-identity.test.ts`

Expected: FAIL because the model and identity modules do not exist.

- [ ] **Step 3: Add exact domain models and identity functions**

Define these stable types in `model.ts`:

```ts
export type DirectNoticeMode = "overlay" | "banner" | "off";
export type ContentNoticeMode = "banner" | "off";
export type DetectionCategory = "direct" | "content";

export interface Settings {
  directNoticeMode: DirectNoticeMode;
  contentNoticeMode: ContentNoticeMode;
}

export const DEFAULT_SETTINGS: Settings = {
  directNoticeMode: "overlay",
  contentNoticeMode: "banner",
};

export interface IgnoreRule {
  scope: "host" | "site";
  value: string;
}

export interface IgnoreChoice {
  label: string;
  rule: IgnoreRule;
}

export interface SiteIdentity {
  hostname: string;
  siteKey: string;
  registrableDomain?: string;
}

export interface DomainSummary {
  directNavigations: number;
  contentNavigations: number;
  lastSeenAt: string;
}
```

Implement identity with `getDomain(hostname, { allowPrivateDomains: true })`, lowercase canonical hostnames, strip IPv6 brackets and trailing dots, and fall back to exact hostname when no registrable domain exists. A site rule matches `host === value || host.endsWith("." + value)`; a host rule matches equality only. `getIgnoreChoices` returns only the exact choice when `registrableDomain` is absent.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/core/site-identity.test.ts && npm run typecheck`

Expected: all identity tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/model.ts src/core/site-identity.ts src/core/site-identity.test.ts
git commit -m "feat: add site identity and ignore matching"
```

### Task 3: CIDR Validation And Cloudflare Classification

**Files:**
- Create: `src/core/default-ranges.ts`
- Create: `src/core/cidr.ts`
- Create: `src/core/cidr.test.ts`
- Create: `src/core/detection.ts`
- Create: `src/core/detection.test.ts`
- Modify: `src/core/model.ts`

**Interfaces:**
- Produces: `DEFAULT_CIDRS: readonly string[]`.
- Produces: `validateCidrText(text): CidrValidation`, `compileCidrs(values): CompiledCidr[]`, and `matchIp(ip, ranges): CompiledCidr | undefined`.
- Produces: `detectCloudflare({ responseHeaders, ip, ranges }): DetectionMatch | null`.

Use these validation contracts:

```ts
export interface CidrError { line: number; input: string; message: string }
export interface CompiledCidr { text: string; kind: "ipv4" | "ipv6"; address: ipaddr.IPv4 | ipaddr.IPv6; prefix: number }
export interface CidrValidation { values: string[]; compiled: CompiledCidr[]; errors: CidrError[] }
```

- [ ] **Step 1: Write failing CIDR tests**

Test canonical network masking, deduplication, IPv4/IPv6 boundaries, blank input, line errors, and mapped IPv4 addresses:

```ts
const result = validateCidrText("104.16.1.7/13\n2606:4700:1234::1/32\n104.16.0.0/13");
expect(result.errors).toEqual([]);
expect(result.values).toEqual(["104.16.0.0/13", "2606:4700::/32"]);
expect(matchIp("104.23.255.255", result.compiled)?.text).toBe("104.16.0.0/13");
expect(matchIp("104.32.0.0", result.compiled)).toBeUndefined();
expect(matchIp("2606:4700::1", result.compiled)?.text).toBe("2606:4700::/32");
expect(validateCidrText("10.0.0.0/33").errors[0]).toMatchObject({ line: 1 });
```

- [ ] **Step 2: Verify CIDR tests fail**

Run: `npm test -- src/core/cidr.test.ts`

Expected: FAIL because `cidr.ts` does not exist.

- [ ] **Step 3: Implement CIDR parsing and bundle reviewed defaults**

Seed `DEFAULT_CIDRS` with the 15 IPv4 and 7 IPv6 ranges published by Cloudflare on 2026-08-18:

```ts
export const DEFAULT_CIDRS = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22", "2400:cb00::/32",
  "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
] as const;
```

Use `ipaddr.parseCIDR`, mask host bits in `toByteArray()`, reconstruct with `ipaddr.fromByteArray`, and compare only addresses of the same normalized kind. Convert IPv4-mapped IPv6 input to IPv4 before comparison. Return line-specific `{ line, input, message }` errors and do not return a partial compiled list when errors exist.

- [ ] **Step 4: Verify CIDR tests pass**

Run: `npm test -- src/core/cidr.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing classifier tests**

```ts
expect(detectCloudflare({ responseHeaders: [{ name: "CF-Ray", value: "abc" }], ranges: [] })?.evidence)
  .toContainEqual({ kind: "header", signal: "cf-ray" });
expect(detectCloudflare({ responseHeaders: [{ name: "Server", value: " cloudflare " }], ranges: [] }))
  .not.toBeNull();
expect(detectCloudflare({ responseHeaders: [{ name: "Server", value: "cloudflare-ish" }], ranges: [] }))
  .toBeNull();
expect(detectCloudflare({ responseHeaders: [{ name: "cf-random", value: "x" }], ranges: [] }))
  .toBeNull();
expect(detectCloudflare({ ip: "104.16.4.3", ranges: compileCidrs(DEFAULT_CIDRS) })?.evidence[0])
  .toMatchObject({ kind: "ip", cidr: "104.16.0.0/13" });
```

- [ ] **Step 6: Implement the classifier**

Extend `model.ts` with discriminated evidence and match types:

```ts
export type DetectionEvidence =
  | { kind: "header"; signal: "cf-ray" | "cf-cache-status" | "cf-mitigated" | "server: cloudflare" }
  | { kind: "ip"; ip: string; cidr: string };

export interface DetectionMatch {
  evidence: DetectionEvidence[];
}
```

Normalize response-header names and values once. Add one evidence row per known signal, deduplicate evidence labels, match `server` only against `cloudflare` or `cloudflare-nginx`, append IP evidence when present, and return `null` when the evidence array is empty.

- [ ] **Step 7: Run classifier and complete core tests**

Run: `npm test -- src/core/cidr.test.ts src/core/detection.test.ts && npm run typecheck`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/model.ts src/core/default-ranges.ts src/core/cidr.ts src/core/cidr.test.ts src/core/detection.ts src/core/detection.test.ts
git commit -m "feat: classify Cloudflare response evidence"
```

### Task 4: Versioned Local Repository

**Files:**
- Create: `src/storage/schema.ts`
- Create: `src/storage/schema.test.ts`
- Create: `src/storage/local-repository.ts`
- Create: `src/storage/local-repository.test.ts`
- Modify: `src/core/model.ts`

**Interfaces:**
- Produces: `LocalRepository` methods `initialize`, `getOptionsSnapshot`, `updateSettings`, `addIgnoreRule`, `removeIgnoreRule`, `saveRanges`, `recordDetection`, `clearActivity`, and `resetSection`.
- Consumes: `DEFAULT_SETTINGS`, `DEFAULT_CIDRS`, `IgnoreRule`, `Settings`, and `DomainSummary`.

- [ ] **Step 1: Write failing schema tests**

Test valid records, invalid rows that generate diagnostics without destroying valid siblings, and schema version 1 defaults. Use these storage keys: `schemaVersion`, `settings`, `ignoreRules`, `ipRanges`, and `summaries`.

```ts
expect(readSettings({ directNoticeMode: "overlay", contentNoticeMode: "banner" })).toEqual({
  value: DEFAULT_SETTINGS,
  diagnostic: undefined,
});
expect(readSettings({ directNoticeMode: "loud" }).diagnostic?.section).toBe("settings");
expect(readSummaries({
  "example.com": { directNavigations: 2, contentNavigations: 1, lastSeenAt: "2026-08-18T12:00:00.000Z" },
  broken: { directNavigations: -1 },
}).value).toHaveProperty("example.com");
```

- [ ] **Step 2: Verify schema tests fail**

Run: `npm test -- src/storage/schema.test.ts`

Expected: FAIL because `schema.ts` does not exist.

- [ ] **Step 3: Implement schema readers**

Add these types to `model.ts`:

```ts
export type StorageSection = "settings" | "ignoreRules" | "ipRanges" | "summaries";
export interface StorageDiagnostic { section: StorageSection; message: string }
export interface OptionsSnapshot {
  settings: Settings;
  ignoreRules: IgnoreRule[];
  ipRanges: string[];
  summaries: Record<string, DomainSummary>;
  diagnostics: StorageDiagnostic[];
}
```

Implement narrow type guards. Valid arrays keep valid rows and diagnose the section if any row is invalid. Invalid top-level settings fall back to `DEFAULT_SETTINGS`; invalid ranges fall back to an empty effective list rather than silently activating bundled values. Diagnostics do not write back automatically.

- [ ] **Step 4: Verify schema tests pass**

Run: `npm test -- src/storage/schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing repository behavior tests**

Use `fakeBrowser.reset()` and browser local storage. Assert first-install seeding, shared-rule deduplication, atomic settings/range writes, count updates, private-count skip at the caller boundary, clear activity, and serialized concurrent increments:

```ts
const repository = new LocalRepository(browser.storage.local);
await repository.initialize();
expect((await repository.getOptionsSnapshot()).ipRanges).toEqual([...DEFAULT_CIDRS]);

await Promise.all([
  repository.recordDetection("example.com", "direct", "2026-08-18T12:00:00.000Z"),
  repository.recordDetection("example.com", "direct", "2026-08-18T12:01:00.000Z"),
]);
expect((await repository.getOptionsSnapshot()).summaries["example.com"]).toEqual({
  directNavigations: 2,
  contentNavigations: 0,
  lastSeenAt: "2026-08-18T12:01:00.000Z",
});
```

- [ ] **Step 6: Verify repository tests fail**

Run: `npm test -- src/storage/local-repository.test.ts`

Expected: FAIL because `LocalRepository` does not exist.

- [ ] **Step 7: Implement serialized repository writes**

Use this storage abstraction and queue shape:

```ts
export interface StorageAreaLike {
  get(keys?: null | string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export class LocalRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly local: StorageAreaLike) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
```

`initialize` seeds all five keys only when `schemaVersion` is absent. Every mutator reads the current stored value inside `enqueue`, writes one canonical replacement, and returns the resulting snapshot or value. A mutation that is not itself an explicit section replacement must reject when that target section has a diagnostic, preserving the raw invalid value until the user saves a valid replacement or confirms `resetSection`. `recordDetection` increments only the requested category and writes the lexically later ISO timestamp. `resetSection` writes the corresponding safe default after explicit user confirmation.

- [ ] **Step 8: Run repository tests and full core suite**

Run: `npm test -- src/storage && npm test -- src/core && npm run typecheck`

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/model.ts src/storage/schema.ts src/storage/schema.test.ts src/storage/local-repository.ts src/storage/local-repository.test.ts
git commit -m "feat: persist local Cloudwatcher settings"
```

### Task 5: Navigation State And Session Store

**Files:**
- Create: `src/background/navigation-state.ts`
- Create: `src/background/navigation-state.test.ts`
- Create: `src/storage/session-navigation-store.ts`
- Create: `src/storage/session-navigation-store.test.ts`
- Modify: `src/core/model.ts`

**Interfaces:**
- Produces: `startNavigation`, `updateRedirectUrl`, `applyDetection`, `deriveNotice`, `dismissNotice`, `suppressNavigation`, and `disableCategory`.
- Produces: `SessionNavigationStore.get(tabId)`, `update(tabId, callback)`, `remove(tabId)`, and `list()`.

- [ ] **Step 1: Write failing navigation reducer tests**

Define scenarios for new request IDs, same-request redirects, cross-domain redirect identity and ignore recomputation, direct/content first detection, one count guard per category, direct priority, one-time dismissal, off-at-start eligibility, and permanent suppression.

```ts
const state = startNavigation({
  tabId: 4,
  requestId: "r1",
  url: "https://example.com/",
  incognito: false,
  settings: DEFAULT_SETTINGS,
  ignored: false,
  navigationId: "nav-1",
});
const content = applyDetection(state, "content", { evidence: [{ kind: "header", signal: "cf-ray" }] }, "cdn.example");
expect(content.shouldCount).toBe(true);
expect(deriveNotice(content.state)).toMatchObject({ kind: "content", mode: "banner" });
const direct = applyDetection(content.state, "direct", { evidence: [{ kind: "header", signal: "cf-ray" }] });
expect(deriveNotice(direct.state)).toMatchObject({ kind: "direct", mode: "overlay" });
expect(applyDetection(direct.state, "direct", direct.state.direct!.match).shouldCount).toBe(false);
```

- [ ] **Step 2: Verify reducer tests fail**

Run: `npm test -- src/background/navigation-state.test.ts`

Expected: FAIL because the reducer does not exist.

- [ ] **Step 3: Implement the pure state model**

Add these state contracts to `model.ts`:

```ts
export interface NavigationState {
  tabId: number;
  requestId: string;
  navigationId: string;
  topLevelUrl: string;
  identity: SiteIdentity;
  incognito: boolean;
  direct?: { match: DetectionMatch };
  content?: { match: DetectionMatch; resourceHost: string };
  counted: Record<DetectionCategory, boolean>;
  dismissed: Record<DetectionCategory, boolean>;
  eligible: Record<DetectionCategory, boolean>;
  suppressedForNavigation: boolean;
}

export interface NoticeState {
  navigationId: string;
  kind: DetectionCategory;
  mode: "overlay" | "banner";
  siteHost: string;
  resourceHost?: string;
  evidence: DetectionEvidence[];
  ignoreChoices: IgnoreChoice[];
}
```

`updateRedirectUrl(state, url, ignored)` preserves the generated navigation ID and warning eligibility, replaces URL and `SiteIdentity`, and replaces `suppressedForNavigation` with the ignore result for the redirected host. This ensures counts and rules apply to the final visited site rather than the initial redirector.

`deriveNotice` follows this exact order: suppressed returns `null`; direct detection returns its eligible direct notice or `null`; only when direct detection is absent may eligible, non-dismissed content return a banner. `applyDetection` preserves the first match and first content host and returns `shouldCount` only on the first category detection.

- [ ] **Step 4: Verify reducer tests pass**

Run: `npm test -- src/background/navigation-state.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing session-store tests**

Test round trips, removal, listing, and two concurrent updates to one tab without a lost mutation. Use keys prefixed `navigation:` and store only session state.

- [ ] **Step 6: Implement the session store with per-tab locks**

Use `StorageAreaLike` and a `Map<number, Promise<unknown>>`. `update` waits for the prior tab operation, reads the latest state, calls the async callback, saves or removes the returned state, and resolves the callback value. Operations for different tabs do not wait on each other.

```ts
async update<T>(
  tabId: number,
  callback: (current: NavigationState | undefined) => Promise<{ state?: NavigationState; value: T }>,
): Promise<T>;
```

- [ ] **Step 7: Run state and store tests**

Run: `npm test -- src/background/navigation-state.test.ts src/storage/session-navigation-store.test.ts && npm run typecheck`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/model.ts src/background/navigation-state.ts src/background/navigation-state.test.ts src/storage/session-navigation-store.ts src/storage/session-navigation-store.test.ts
git commit -m "feat: track per-navigation detection state"
```

### Task 6: Background Controller And Runtime Protocol

**Files:**
- Create: `src/core/messages.ts`
- Create: `src/background/browser-adapter.ts`
- Create: `src/background/controller.ts`
- Create: `src/background/controller.test.ts`
- Modify: `src/entrypoints/background.ts`

**Interfaces:**
- Produces: `RuntimeRequest` and `RuntimeResponse` discriminated unions.
- Produces: `BackgroundController.initialize`, `handleBeforeRequest`, `handleResponseStarted`, `handleMessage`, and `handleTabRemoved`.
- Consumes: `LocalRepository`, `SessionNavigationStore`, `detectCloudflare`, and navigation reducer functions.

`BrowserAdapter` exposes only:

```ts
export interface BrowserAdapter {
  sendNotice(tabId: number, message: RuntimePush): Promise<void>;
  getTabUrl(tabId: number): Promise<string | undefined>;
  goBack(tabId: number): Promise<void>;
  replaceWithBlank(tabId: number): Promise<void>;
}
```

- [ ] **Step 1: Write failing direct and content controller tests**

Use in-memory storage and a fake adapter. Assert a main-frame event starts state, a positive main-frame response records one direct count and sends an overlay, subresource responses record one content count, repeated responses do not recount, direct replaces content, ignored/off navigations still count, private events do not call `recordDetection`, and a rejected summary write still sends the notice and retries on a later match.

```ts
await controller.handleBeforeRequest({
  requestId: "main-1", tabId: 8, type: "main_frame", url: "https://example.com/", incognito: false,
});
await controller.handleResponseStarted({
  requestId: "main-1", tabId: 8, type: "main_frame", url: "https://example.com/",
  incognito: false, responseHeaders: [{ name: "cf-ray", value: "abc" }],
});
expect(adapter.sent.at(-1)?.notice).toMatchObject({ kind: "direct", mode: "overlay" });
expect((await repository.getOptionsSnapshot()).summaries["example.com"].directNavigations).toBe(1);
```

- [ ] **Step 2: Verify controller tests fail**

Run: `npm test -- src/background/controller.test.ts`

Expected: FAIL because the controller and protocol do not exist.

- [ ] **Step 3: Define the complete runtime protocol**

Define the protocol in `messages.ts` with these exact contracts:

```ts
export type RuntimeRequest =
  | { type: "content/handshake"; url: string }
  | { type: "notice/continue"; navigationId: string }
  | { type: "notice/ignore"; navigationId: string; rule: IgnoreRule }
  | { type: "notice/leave"; navigationId: string }
  | { type: "popup/get"; tabId: number }
  | { type: "options/get" }
  | { type: "options/update-settings"; settings: Settings }
  | { type: "options/remove-ignore"; rule: IgnoreRule }
  | { type: "options/save-ranges"; draft: string }
  | { type: "options/clear-activity" }
  | { type: "options/reset-section"; section: StorageSection };

export interface HandshakeData {
  navigationId: string | null;
  notice: NoticeState | null;
}

export interface PopupState {
  status: "direct" | "content" | "none" | "unavailable";
  ignored: boolean;
  hostname?: string;
  contentHost?: string;
  evidence: DetectionEvidence[];
  summary?: DomainSummary;
}

export type RuntimePush = {
  type: "notice/update";
  navigationId: string;
  notice: NoticeState | null;
};

export type RuntimeResponse<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; validationErrors?: CidrError[] };
```

Notice actions carry `navigationId`; ignore also carries one of the exact choices returned by `getIgnoreChoices`. Options range save carries raw draft text so background validation remains authoritative and can return line errors.

- [ ] **Step 4: Implement the controller detection path**

`initialize` seeds storage and caches settings, rules, and compiled ranges. `handleBeforeRequest` accepts only supported top-level HTTP/HTTPS navigation, calls `updateRedirectUrl` with a freshly evaluated ignore match for the same request ID, and starts a state with settings eligibility and ignore status for a new request ID. Generate IDs with injected `createNavigationId`, defaulting to `crypto.randomUUID`, and timestamps with injected `now`, defaulting to `new Date().toISOString()`.

`handleResponseStarted` rejects unsupported protocols and `tabId < 0`, waits for initialization, classifies available headers/IP, updates one tab under the session-store lock, records a first non-private category detection, and sends `notice/update` with `deriveNotice`. A failed summary write must not suppress the detection or notice; keep the category's counted flag false so a later matching response can retry, retain the prior stored summary, and write one warning to the extension console. A rejected `tabs.sendMessage` is swallowed only by `BrowserAdapter.sendNotice`.

- [ ] **Step 5: Write failing message/action tests**

Test handshake URL and navigation-ID protection, continue dismissal, exact and whole-site ignore persistence, explicit private-window ignore persistence, popup states, options snapshots, off-mode closing, enabling only on next navigation, CIDR validation errors, clear activity, and leave fallback:

```ts
adapter.goBackError = new Error("no history");
const response = await controller.handleMessage(
  { type: "notice/leave", navigationId: "nav-1" },
  { tab: { id: 8 } },
);
expect(response).toEqual({ ok: true, data: undefined });
expect(adapter.blankTabs).toEqual([8]);
```

- [ ] **Step 6: Implement message routing and live suppression**

Validate sender tab IDs and navigation IDs before mutation. Continue dismisses the currently derived category. Permanent ignore canonicalizes and persists the selected rule, sets `suppressedForNavigation`, and sends `null`. Setting a category to off marks matching current navigation eligibility false and sends an updated notice; enabling does not mutate current eligibility. Removing a rule changes the persistent cache only. Range saves call `validateCidrText`, reject the whole draft on errors, persist canonical values on success, and replace the compiled cache for future responses.

Popup states are `direct`, `content`, `none`, or `unavailable`, with `ignored` as a separate boolean. `BrowserAdapter.getTabUrl(tabId)` distinguishes a supported HTTP/HTTPS page with no positive state (`none`) from protected and browser-internal pages (`unavailable`). Return fixed evidence labels, current content host, and the current site's summary only.

- [ ] **Step 7: Wire synchronous background listeners**

```ts
import { BackgroundController } from "@/background/controller";
import { createBrowserAdapter } from "@/background/browser-adapter";
import { LocalRepository } from "@/storage/local-repository";
import { SessionNavigationStore } from "@/storage/session-navigation-store";

export default defineBackground(() => {
  const repository = new LocalRepository(browser.storage.local);
  const navigationStore = new SessionNavigationStore(browser.storage.session);
  const controller = new BackgroundController(repository, navigationStore, createBrowserAdapter());
  const ready = controller.initialize();

  browser.webRequest.onBeforeRequest.addListener(
    (details) => void ready.then(() => controller.handleBeforeRequest(details)),
    { urls: ["<all_urls>"], types: ["main_frame"] },
  );
  browser.webRequest.onResponseStarted.addListener(
    (details) => void ready.then(() => controller.handleResponseStarted(details)),
    { urls: ["<all_urls>"] },
    ["responseHeaders"],
  );
  browser.runtime.onMessage.addListener((message, sender) =>
    ready.then(() => controller.handleMessage(message, sender)),
  );
  browser.tabs.onRemoved.addListener((tabId) => void controller.handleTabRemoved(tabId));
});
```

- [ ] **Step 8: Run controller, type, and build verification**

Run: `npm test -- src/background src/storage src/core && npm run typecheck && npm run build`

Expected: all tests PASS and both manifests contain `webRequest`, `storage`, `tabs`, and the background entrypoint.

- [ ] **Step 9: Commit**

```bash
git add src/core/messages.ts src/background/browser-adapter.ts src/background/controller.ts src/background/controller.test.ts src/entrypoints/background.ts
git commit -m "feat: monitor Cloudflare responses in background"
```

### Task 7: Overlay And Banner Content Notice

**Files:**
- Create: `src/entrypoints/cloudwatcher.content/Notice.tsx`
- Create: `src/entrypoints/cloudwatcher.content/Notice.test.tsx`
- Create: `src/entrypoints/cloudwatcher.content/notice.css`
- Create: `src/entrypoints/cloudwatcher.content/index.tsx`
- Modify: `src/core/messages.ts`

**Interfaces:**
- Consumes: `NoticeState`, `RuntimeRequest`, and `RuntimeResponse`.
- Produces: top-frame `document_start` content entrypoint and `notice/update` receiver.

- [ ] **Step 1: Write failing component interaction tests**

Render `Notice` directly and assert calm direct/content copy, hostname text, overlay modal semantics, banner non-modal semantics, Continue, Go back, exact/whole-site chooser, exact-only localhost behavior, Escape, focus trap, error text, and no raw URL display. Run `axe-core` against overlay and banner roots and require zero serious or critical violations.

```tsx
render(<Notice notice={directNotice} onAction={onAction} />);
expect(screen.getByRole("dialog", { name: /cloudflare detected/i })).toHaveAttribute("aria-modal", "true");
await user.click(screen.getByRole("button", { name: "Don't warn here again" }));
await user.click(screen.getByRole("button", { name: "example.com and all subdomains" }));
expect(onAction).toHaveBeenCalledWith({ type: "ignore", rule: { scope: "site", value: "example.com" } });
```

- [ ] **Step 2: Verify component tests fail**

Run: `npm test -- src/entrypoints/cloudwatcher.content/Notice.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the notice component**

Use a heading of `Cloudflare detected for this site` for direct and `This page loads content through Cloudflare` for content. Use buttons `Continue once`, `Go back`, and `Don't warn here again`. The permanent chooser uses labels supplied in `NoticeState`, plus `Cancel`.

For overlay mode, auto-focus `Continue once`, keep Tab/Shift+Tab inside the component, redirect escaped focus, and map Escape to continue. For banner mode, do not auto-focus or globally capture keys; map Escape only from a focused banner descendant. Disable actions while awaiting the background and render `Cloudwatcher could not save that choice. Try again.` when a response fails.

- [ ] **Step 4: Add isolated visual styling**

`notice.css` must set the host to `position: fixed`, `inset: 0`, and `z-index: 2147483647`; use pixel-based sizing so hostile root `font-size` cannot rescale it. Overlay uses a translucent ink scrim and centered porcelain/ink panel. Banner pins to the top, has pointer events only inside its panel, wraps controls below 640px, respects `prefers-color-scheme` and `prefers-reduced-motion`, and uses a 2px signal-orange focus ring. Do not use blur as the only separation from the page.

- [ ] **Step 5: Verify notice tests pass**

Run: `npm test -- src/entrypoints/cloudwatcher.content/Notice.test.tsx`

Expected: PASS with zero serious/critical axe violations.

- [ ] **Step 6: Write a failing content-entrypoint lifecycle test**

Extract and test `createNoticeRuntime` with fake `sendMessage`, message subscription, host creation, render, and remove functions. Assert no render before handshake, stale navigation IDs are ignored, a `null` update removes the host, and previous focus is restored after overlay removal.

- [ ] **Step 7: Implement the closed Shadow DOM entrypoint**

Set `matches: ["http://*/*", "https://*/*"]`, `allFrames: false`, `runAt: "document_start"`, and isolated world. Import `notice.css?inline`, append one `cloudwatcher-notice` host to `document.documentElement`, attach `{ mode: "closed" }`, add a `<style>` and mount node, and render with Preact. Keep the closed root reference in the runtime closure.

Handshake with `{ type: "content/handshake", url: location.href }`. Do not process pushes before the successful handshake. Thereafter accept only `notice/update` messages whose navigation ID matches the handshake. Send action requests with that ID, and remove/unmount when background returns no notice.

- [ ] **Step 8: Run notice, type, and build checks**

Run: `npm test -- src/entrypoints/cloudwatcher.content && npm run typecheck && npm run build`

Expected: tests PASS and both manifests list one top-frame HTTP/HTTPS content script at `document_start`.

- [ ] **Step 9: Commit**

```bash
git add src/core/messages.ts src/entrypoints/cloudwatcher.content
git commit -m "feat: show Cloudflare overlay and banner"
```

### Task 8: Current-Tab Popup

**Files:**
- Create: `src/ui/brand.tsx`
- Create: `src/ui/base.css`
- Create: `src/entrypoints/popup/index.html`
- Create: `src/entrypoints/popup/main.tsx`
- Create: `src/entrypoints/popup/App.tsx`
- Create: `src/entrypoints/popup/App.test.tsx`
- Create: `src/entrypoints/popup/style.css`

**Interfaces:**
- Consumes: `popup/get` response with status, evidence, suppression, content host, and current-site summary.
- Produces: toolbar popup and settings link via `browser.runtime.openOptionsPage()`.

- [ ] **Step 1: Write failing popup state tests**

Test loading, direct, content, no-observation, ignored, unavailable, and recoverable-error states. Verify direct/content counts and fixed evidence labels, and ensure `No Cloudflare observed` appears instead of an absolute negative claim.

- [ ] **Step 2: Verify popup tests fail**

Run: `npm test -- src/entrypoints/popup/App.test.tsx`

Expected: FAIL because popup files do not exist.

- [ ] **Step 3: Implement popup data loading and UI**

On mount, query the active tab, send `{ type: "popup/get", tabId }`, and render a 360px-wide instrument panel. Use these status headings: `Site uses Cloudflare`, `Cloudflare content observed`, `No Cloudflare observed`, and `Detection unavailable`. Show an `Ignored for this site` pill separately. Evidence labels are `CF-Ray header`, `CF-Cache-Status header`, `CF-Mitigated header`, `Cloudflare server header`, and `Cloudflare IP range`.

Display two count cells labeled `Direct visits` and `Content visits`, or zero when no summary exists. The footer button says `Open Cloudwatcher settings`.

`index.html` sets UTF-8, viewport metadata, and title `Cloudwatcher`. `main.tsx` imports `@/ui/base.css` and `./style.css`, then renders `<App />` into `#app`. Include an axe scan in `App.test.tsx` for direct, content, none, and unavailable states.

- [ ] **Step 4: Add shared brand and popup styles**

Create a CSS-only eye/radar mark in `brand.tsx`, not a Cloudflare logo. `base.css` defines ink, porcelain, smoke, signal orange, success teal, muted text, 8px spacing increments, system sans body text, monospace evidence labels, and a visible `:focus-visible` ring. Popup styles must handle 200% zoom without horizontal scrolling.

- [ ] **Step 5: Run popup tests and build**

Run: `npm test -- src/entrypoints/popup && npm run typecheck && npm run build`

Expected: popup tests PASS and generated manifests contain an action popup.

- [ ] **Step 6: Commit**

```bash
git add src/ui src/entrypoints/popup
git commit -m "feat: add current-tab Cloudflare status popup"
```

### Task 9: Warning, Ignore, And Activity Options

**Files:**
- Create: `src/entrypoints/options/index.html`
- Create: `src/entrypoints/options/main.tsx`
- Create: `src/entrypoints/options/App.tsx`
- Create: `src/entrypoints/options/App.test.tsx`
- Create: `src/entrypoints/options/WarningsView.tsx`
- Create: `src/entrypoints/options/IgnoredView.tsx`
- Create: `src/entrypoints/options/ActivityView.tsx`
- Create: `src/entrypoints/options/style.css`

**Interfaces:**
- Consumes: `options/get`, `options/update-settings`, `options/remove-ignore`, and `options/clear-activity`.
- Produces: full-tab views for warning modes, shared rules, and domain summaries.

- [ ] **Step 1: Write failing options tests**

Test initial loading, three-view navigation, direct/content mode changes, mutation failure rollback, searchable ignore rules, remove confirmation, sorted activity rows, empty states, clear confirmation, diagnostics banner, and narrow-layout semantics.

```tsx
await user.selectOptions(screen.getByLabelText("Direct-site notice"), "banner");
expect(sendRequest).toHaveBeenCalledWith({
  type: "options/update-settings",
  settings: { directNoticeMode: "banner", contentNoticeMode: "banner" },
});
```

- [ ] **Step 2: Verify options tests fail**

Run: `npm test -- src/entrypoints/options/App.test.tsx`

Expected: FAIL because options files do not exist.

- [ ] **Step 3: Implement options shell and warning controls**

Open options in a full tab. Use a left rail above 800px and horizontal scrollable view tabs below it. This task's views are `Warnings`, `Ignored sites`, and `Activity`; Task 10 adds `IP ranges` with its complete behavior. `WarningsView` uses native selects with exact allowed values and explanatory text that disabled warnings still count detections. Save on explicit `Save warning settings`, disable during mutation, and keep the user's draft after an error.

`index.html` sets UTF-8, viewport metadata, title `Cloudwatcher settings`, and `<meta name="manifest.open_in_tab" content="true" />`. `main.tsx` imports `@/ui/base.css` and `./style.css`, then renders `<App />` into `#app`.

- [ ] **Step 4: Implement ignored-site and activity views**

`IgnoredView` filters canonical rule labels as the user types, shows `Exact host` or `Whole site`, and confirms removal in an accessible dialog. `ActivityView` sorts by `lastSeenAt` descending, shows domain, direct count, content count, and localized timestamp, and confirms `Clear all activity`. Empty copy states that no detailed URL history is stored.

- [ ] **Step 5: Add responsive options styling**

Use a bounded 1180px workspace, a quiet ruled-paper background, high-density summary rows rather than generic cards, sticky view navigation on desktop, and single-column controls below 640px. Preserve native control semantics, visible focus, light/dark colors, and reduced motion.

- [ ] **Step 6: Run options tests and accessibility scan**

Run: `npm test -- src/entrypoints/options/App.test.tsx && npm run typecheck && npm run build`

Expected: tests and the App axe scan PASS, and generated manifests contain an options page that opens in a tab.

- [ ] **Step 7: Commit**

```bash
git add src/entrypoints/options
git commit -m "feat: add warning and activity settings"
```

### Task 10: Managed CIDR Editor And Recovery Diagnostics

**Files:**
- Create: `src/entrypoints/options/RangesView.tsx`
- Create: `src/entrypoints/options/RangesView.test.tsx`
- Modify: `src/entrypoints/options/App.tsx`
- Modify: `src/entrypoints/options/App.test.tsx`
- Modify: `src/entrypoints/options/style.css`
- Modify: `src/core/messages.ts`
- Modify: `src/background/controller.ts`
- Modify: `src/background/controller.test.ts`

**Interfaces:**
- Consumes: `options/save-ranges` and `options/reset-section`.
- Produces: newline CIDR draft import/export/reset/save flow and section-specific corruption recovery.

- [ ] **Step 1: Write failing CIDR editor tests**

Test untouched initial draft, line-numbered validation errors, no save on any error, valid canonical save, empty-list save, plain-text import replacing only the draft, export of the saved list, reset loading bundled values into the draft without saving, dirty-state navigation warning, and storage diagnostic reset confirmation.

- [ ] **Step 2: Verify CIDR editor tests fail**

Run: `npm test -- src/entrypoints/options/RangesView.test.tsx`

Expected: FAIL because `RangesView` does not exist.

- [ ] **Step 3: Implement local draft and file operations**

Use one CIDR per line in a labeled monospace textarea. Validate on save in the background and map returned `{ line, input, message }` rows to an error summary plus `aria-describedby`. Import accepts `.txt,text/plain`, reads with `File.text()`, and replaces the draft only. Export creates a UTF-8 Blob from the last saved list, clicks a temporary `cloudwatcher-ip-ranges.txt` anchor, and revokes the object URL.

Reset sends no mutation; it copies `DEFAULT_CIDRS.join("\n")` into the draft after confirmation. The user must press `Save IP ranges` to activate it. An empty trimmed draft saves `[]` and displays `Header-only detection is active.`

Add `IP ranges` as the fourth options view only after `RangesView` exists. Extend the App navigation test to cover all four views and run an axe scan with the range editor and validation summary visible.

- [ ] **Step 4: Add diagnostic recovery messages**

For each `StorageDiagnostic`, show the affected section and an explicit `Reset this section` action. The controller routes reset to repository defaults, refreshes its settings/rules/range cache, and returns a fresh options snapshot. No diagnostic action clears unrelated sections.

- [ ] **Step 5: Run UI and controller tests**

Run: `npm test -- src/entrypoints/options src/background/controller.test.ts && npm run typecheck`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/options src/core/messages.ts src/background/controller.ts src/background/controller.test.ts
git commit -m "feat: manage Cloudflare IP ranges"
```

### Task 11: Brand Assets, Privacy, And Contributor Documentation

**Files:**
- Create: `public/icon-source.svg`
- Create: `scripts/generate-icons.mjs`
- Generate: `public/icon-16.png`
- Generate: `public/icon-32.png`
- Generate: `public/icon-48.png`
- Generate: `public/icon-96.png`
- Generate: `public/icon-128.png`
- Create: `docs/PRIVACY.md`
- Create: `docs/STORE-LISTING.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: WXT auto-discovered icon sizes and `npm run icons`.
- Documents: exact permissions, retained data, private-window behavior, cache blind spots, and local development commands.

- [ ] **Step 1: Add the icon generation test command and verify failure**

Add `"icons": "node scripts/generate-icons.mjs"` and `sharp@^0.35.3` to dev dependencies, then run `npm install && npm run icons`.

Expected: FAIL because the source SVG and script do not exist.

- [ ] **Step 2: Create a distinct Cloudwatcher icon and deterministic generator**

The SVG uses a rounded ink square, an orange horizon arc, and a centered porcelain observation dot. It must not reproduce Cloudflare's cloud mark. `generate-icons.mjs` reads the SVG and uses `sharp` to write exactly 16, 32, 48, 96, and 128 pixel PNGs with no network access.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Cloudwatcher">
  <rect width="128" height="128" rx="28" fill="#17191f"/>
  <path d="M24 76 Q64 28 104 76" fill="none" stroke="#f47a28" stroke-width="10" stroke-linecap="round"/>
  <path d="M31 88 H97" fill="none" stroke="#f6efe3" stroke-width="6" stroke-linecap="round" opacity=".72"/>
  <circle cx="64" cy="61" r="11" fill="#f6efe3"/>
  <circle cx="64" cy="61" r="4" fill="#f47a28"/>
</svg>
```

```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = await readFile(new URL("../public/icon-source.svg", import.meta.url));
for (const size of [16, 32, 48, 96, 128]) {
  const output = fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url));
  await sharp(source).resize(size, size).png().toFile(output);
}
```

- [ ] **Step 3: Write privacy and development documentation**

`docs/PRIVACY.md` must state no telemetry, remote lookups, automatic range fetches, remote code, or sync; list every persistent and session field; explain private activity behavior; explain broad web-host access; document cache/header/IP false negatives and user-list false positives; and explain activity clearing.

`docs/STORE-LISTING.md` contains a short and full description, the all-sites and `webRequest` permission rationale, retained-data summary, detection limitations, contact wording that points to the repository issue tracker, and a statement that Cloudwatcher is not affiliated with or endorsed by Cloudflare.

Replace the one-line README with install, Firefox/Chromium development, test, build, temporary loading, IP management, known limitations, privacy link, and an unaffiliated-project disclaimer. Use only commands that exist in `package.json`.

- [ ] **Step 4: Verify assets and both builds**

Run: `npm run icons && npm run build && npm run typecheck`

Expected: five PNGs exist and both generated manifests list icon sizes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json public scripts/generate-icons.mjs docs/PRIVACY.md docs/STORE-LISTING.md README.md
git commit -m "docs: add Cloudwatcher identity and privacy guide"
```

### Task 12: Chromium End-To-End Smoke Tests

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/fixture-server.mjs`
- Create: `e2e/cloudwatcher.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `npm run test:e2e` against `.output/chrome-mv3`.
- Exercises: direct header overlay, content banner, one-time dismissal, permanent ignore, popup counts, and options mode changes.

- [ ] **Step 1: Add Playwright and write a failing plain-page smoke test**

Add `@playwright/test@^1.62.1`, scripts `test:e2e:install`, `test:e2e`, and a web-server config that starts the local fixture on `127.0.0.1:4173`. The fixture serves:

- `/plain`: no Cloudflare evidence.
- `/direct`: `cf-ray` response header.
- `/content`: plain HTML that requests `/cf-image.svg`.
- `/cf-image.svg`: `cf-cache-status: HIT` response header.

Launch Chromium persistent context with `--disable-extensions-except` and `--load-extension` pointing at `.output/chrome-mv3`. The first test expects no `cloudwatcher-notice` host on `/plain`.

- [ ] **Step 2: Run the E2E test and verify its initial failure**

Run: `npm install && npm run build:chrome && npx playwright install chromium && npm run test:e2e`

Expected: FAIL until the extension launch helper and fixture lifecycle are complete.

- [ ] **Step 3: Complete the fixture and extension launch helper**

Resolve the extension service worker ID from `context.serviceWorkers()`, expose helpers for popup and options extension URLs, and close context/server in fixtures. Use a fresh temporary user data directory per test so ignore rules and counts cannot leak.

- [ ] **Step 4: Add release-path Chromium scenarios**

Because production Shadow DOM is closed, assert the visible host and use keyboard focus/Enter for notice actions. Cover:

- `/direct` mounts a viewport-sized host and Enter on the auto-focused Continue button removes it.
- Reloading `/direct` mounts it again.
- `/content` mounts a top banner while a fixture page button remains clickable.
- Direct mode changed to banner in options changes the next `/direct` notice geometry.
- Exact-host permanent ignore suppresses both direct and content notices on the next navigation while popup counts continue increasing.
- Popup shows direct/content evidence and nonzero summary counts.

- [ ] **Step 5: Run the Chromium suite twice**

Run: `npm run test:e2e && npm run test:e2e`

Expected: both runs PASS with isolated profiles and no order dependency.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json playwright.config.ts e2e
git commit -m "test: cover Chromium extension journeys"
```

### Task 13: Firefox Lint, Package Verification, And Release Matrix

**Files:**
- Create: `scripts/verify-package.mjs`
- Create: `scripts/verify-package.test.ts`
- Create: `docs/TESTING.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `npm run lint:firefox`, `npm run verify:packages`, `npm run package`, and `npm run verify`.
- Produces: release-blocking Firefox temporary-profile checklist.

- [ ] **Step 1: Write failing package-verification tests**

Test a pure `inspectManifest` function with fixture manifests. It must reject missing required permissions, unexpected permissions, non-MV3 output, absent popup/options/content/background entries, and script URLs with `http:`, `https:`, or protocol-relative remote sources. It must accept exactly the generated Cloudwatcher shape.

- [ ] **Step 2: Verify package tests fail**

Run: `npm test -- scripts/verify-package.test.ts`

Expected: FAIL because `verify-package.mjs` does not exist.

- [ ] **Step 3: Implement artifact inspection and release scripts**

Add `web-ext@^10.6.0` and these scripts:

```json
{
  "lint:firefox": "npm run build:firefox && web-ext lint --source-dir .output/firefox-mv3",
  "verify:packages": "node scripts/verify-package.mjs",
  "package": "wxt zip -b chrome --mv3 && wxt zip -b firefox --mv3",
  "verify": "npm run lint && npm run typecheck && npm test && npm run build && npm run verify:packages && npm run lint:firefox"
}
```

`verify-package.mjs` reads both generated manifests, applies `inspectManifest`, recursively scans generated text assets for remote script/import syntax, prints one line per verified browser, and exits nonzero with all discovered violations.

- [ ] **Step 4: Write the Firefox release smoke matrix**

`docs/TESTING.md` gives exact `npm run dev:firefox` and temporary-add-on steps, then checkboxes for direct overlay, direct banner, direct off, content banner, content off, continue/reload, exact host, whole site, history back, `about:blank` fallback, custom IPv4 and IPv6 CIDRs, empty header-only ranges, invalid line rejection, ignored/disabled counting, private non-counting, popup states, activity clearing, 200% zoom, keyboard-only navigation, light/dark mode, and protected pages.

Include the known cache and tab-association limitations and require testing current Firefox ESR and stable Firefox before release.

- [ ] **Step 5: Run full verification and package**

Run: `npm install && npm run verify && npm run test:e2e && npm run package`

Expected: Biome, TypeScript, all Vitest suites, both builds, artifact inspection, Firefox lint, Chromium E2E, and both zip commands PASS.

- [ ] **Step 6: Inspect final repository state**

Run: `git status --short && git diff --stat && git log --oneline -15`

Expected: only intended Task 13 files are uncommitted; no generated `.output`, `.wxt`, test report, or local browser profile is tracked.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/verify-package.mjs scripts/verify-package.test.ts docs/TESTING.md README.md
git commit -m "build: verify Firefox and Chromium packages"
```

- [ ] **Step 8: Perform the Firefox manual matrix**

Run: `npm run dev:firefox`

Expected: every checkbox in `docs/TESTING.md` passes on current Firefox ESR and current stable Firefox. Record browser versions and date at the bottom of the checklist before publishing; do not commit a passing record without actually executing it.
