# CI Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the release-automation commit pass CI without changing extension behavior and remove the Biome deprecation warning.

**Architecture:** Keep the existing CI workflow and verification scripts unchanged in behavior. Apply Biome's canonical formatting to the verifier and migrate only its deprecated configuration property. Validate every workflow command using Node 26.7.0.

**Tech Stack:** Node 26.7.0, npm 11, Biome 2.5.9, Vitest, WXT, Playwright, web-ext.

## Global Constraints

- Do not change extension behavior, CI triggers, permissions, release automation, or dependency versions.
- Use Node 26.7.0 from `.nvmrc` for every validation command.
- Preserve the verifier's remote-script detection behavior.

---

### Task 1: Restore Biome Compliance

**Files:**
- Modify: `scripts/verify-package.mjs:120-137`
- Modify: `biome.json:13-16`
- Test: `scripts/verify-package.test.ts`

**Interfaces:**
- Consumes: `inspectArtifact(browser, directory)` from `scripts/verify-package.mjs`.
- Produces: The same artifact-verification results with canonical source formatting and a non-deprecated Biome linter preset.

- [ ] **Step 1: Establish verifier behavior before configuration-only changes**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm test -- scripts/verify-package.test.ts
```

Expected: all package-verifier tests pass, proving the change must remain behavior-preserving.

- [ ] **Step 2: Apply the formatter-required source shape and supported linter preset**

Change the HTML-script scan callback to Biome's single callback expression shape and replace:

```json
"rules": { "recommended": true }
```

with:

```json
"rules": { "preset": "recommended" }
```

- [ ] **Step 3: Verify formatter and linter compliance**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm run lint
```

Expected: `Checked 64 files` with no errors or deprecation diagnostics.

- [ ] **Step 4: Verify the unchanged artifact inspection behavior**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm test -- scripts/verify-package.test.ts
```

Expected: all package-verifier tests pass.

### Task 2: Validate the CI Workflow Locally

**Files:**
- Modify: None
- Test: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the repository scripts invoked by the `verify` job in `.github/workflows/ci.yml`.
- Produces: passing local evidence for linting, type checking, tests, browser builds, package verification, Firefox linting, E2E testing, packaging, and coverage.

- [ ] **Step 1: Run the full verification gate**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm run verify
```

Expected: lint, type check, unit tests, both builds, package verification, and Firefox lint all pass.

- [ ] **Step 2: Install CI's E2E browser dependency**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm run test:e2e:install
```

Expected: Playwright Chromium installation succeeds.

- [ ] **Step 3: Run browser tests**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm run test:e2e
```

Expected: all Chromium extension journeys pass.

- [ ] **Step 4: Produce release packages**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm run package
```

Expected: Chromium and Firefox ZIP files are written to `.output`.

- [ ] **Step 5: Generate CI coverage artifact**

Run:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use 26.7.0 && npm run test:coverage
```

Expected: all tests pass and `coverage/lcov.info` exists.
