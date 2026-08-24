# GitHub Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub CI, coverage reporting, semantic releases, and browser ZIP release assets.

**Architecture:** CI runs every existing verification layer plus coverage and uploads release evidence. A separate workflow only releases successful `main` builds using a local Conventional Commit calculator, which updates the package version and attaches packaged extension ZIPs without npm publication.

**Tech Stack:** GitHub Actions, Node 26.7.0, Vitest V8 coverage, Playwright Chromium, web-ext, GitHub CLI.

## Global Constraints

- Use `.nvmrc` Node `26.7.0` and lockfile-only installation with `npm ci`.
- CI must have read-only permissions; release must have only `contents: write`.
- No release publishes to npm or requires third-party service tokens.
- Release only follows a successful `main` CI workflow and only from conventional commits.
- Keep generated outputs untracked.

---

### Task 1: Coverage and Version Calculation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/release-version.mjs`
- Test: `scripts/release-version.test.ts`

**Interfaces:**
- Produces: `npm run test:coverage` and `nextReleaseVersion(currentVersion, commits)` for release automation.

- [ ] **Step 1: Add the coverage script and V8 provider**

```json
"test:coverage": "vitest run --coverage",
"@vitest/coverage-v8": "4.1.11"
```

- [ ] **Step 2: Regenerate the lockfile using Node 26**

Run: `source "$HOME/.nvm/nvm.sh" && nvm exec 26 npm install --package-lock-only`

Expected: lockfile resolves every declared automation dependency without changing production dependencies.

- [ ] **Step 3: Verify coverage**

Run: `source "$HOME/.nvm/nvm.sh" && nvm exec 26 npm run test:coverage`

Expected: all tests pass and `coverage/lcov.info` exists.

### Task 2: Conventional Commit Release Calculation

**Files:**
- Create: `scripts/release-version.mjs`
- Create: `scripts/release-version.test.ts`

**Interfaces:**
- Consumes: a current semantic version and Conventional Commit subjects/bodies.
- Produces: either `null` or the next patch, minor, or major semantic version.

- [ ] **Step 1: Add tests for the release rules**

```json
expect(nextReleaseVersion("1.2.3", ["fix: correct a defect"])).toBe("1.2.4");
expect(nextReleaseVersion("1.2.3", ["feat: add a setting"])).toBe("1.3.0");
expect(nextReleaseVersion("1.2.3", ["feat!: replace an API"])).toBe("2.0.0");
```

- [ ] **Step 2: Implement and verify local release analysis**

Run: `source "$HOME/.nvm/nvm.sh" && nvm exec 26 npx vitest run scripts/release-version.test.ts`

Expected: patch, minor, major, and no-release rules all pass without GitHub credentials.

### Task 3: GitHub CI and Release Workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: npm scripts, coverage output, release configuration, and CI completion event.
- Produces: PR status checks, downloadable coverage/ZIP artifacts, and serialized GitHub releases.

- [ ] **Step 1: Create CI workflow**

```yaml
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
```

Run `npm ci`, `npm run verify`, `npm run test:coverage`, `npm run test:e2e`, and `npm run package`; upload `coverage/lcov.info` and both extension ZIP files with `actions/upload-artifact@v4`.

- [ ] **Step 2: Create release workflow**

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
permissions:
  contents: write
```

Guard execution for a successful `main` CI run, check out the tested commit SHA, install with `npm ci`, calculate the release version, run `npm version --no-git-tag-version`, package ZIPs, commit version files, and create a GitHub release with `gh release create`. Configure a `release-main` concurrency group with `cancel-in-progress: false`.

- [ ] **Step 3: Validate workflow files**

Run: `source "$HOME/.nvm/nvm.sh" && nvm exec 26 npm run lint && nvm exec 26 npm run typecheck && npx prettier --check .github/workflows/*.yml .releaserc.json`

Expected: project checks pass and workflow files parse/format cleanly.

### Task 4: End-to-End Automation Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/TESTING.md`

**Interfaces:**
- Consumes: CI/release workflows and semantic release configuration.
- Produces: documented contributor expectations and release procedure.

- [ ] **Step 1: Document required conventional commits and CI coverage artifacts**

State that `feat:`, `fix:`, and breaking-change commits determine semantic versions after merge to `main`, and that manual Firefox ESR/stable checks remain release requirements.

- [ ] **Step 2: Run the complete local evidence suite**

Run: `source "$HOME/.nvm/nvm.sh" && nvm exec 26 npm run verify && nvm exec 26 npm run test:coverage && nvm exec 26 npm run test:e2e && nvm exec 26 npm run package`

Expected: all commands pass; release publication itself remains GitHub-hosted and is not executed locally.
