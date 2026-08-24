# GitHub Automation Design

## Goal

Protect every pull request and `main` update with the existing Cloudwatcher quality gates, publish coverage evidence, and create semver GitHub releases directly from conventional commits merged to `main`.

## Architecture

`ci.yml` runs on pull requests and pushes to `main`. It installs the locked Node 26.7.0 dependency graph, runs lint/typecheck/unit coverage/build/package inspection/Firefox lint/Chromium E2E/package creation, then uploads LCOV and ZIP artifacts. It is read-only and never releases.

`release.yml` runs only after successful CI on a `main` push. It uses a dependency-free Conventional Commit calculator with the repository `GITHUB_TOKEN`, updates package versions, creates a GitHub release, and attaches the Chrome and Firefox ZIPs. It is serialized so releases cannot race.

## Decisions

- Use a local Conventional Commit calculator rather than a dependency-heavy release package: a qualifying commit merged to `main` is released immediately without adding release-tool audit exposure.
- Use V8 coverage and upload `coverage/lcov.info` as a GitHub Actions artifact. Do not introduce a third-party coverage service or secret.
- Do not publish to npm. Cloudwatcher is a browser extension; the only release assets are the generated extension ZIPs.
- Give CI read-only permissions and release only `contents: write` permissions.
- Require `npm ci` and `.nvmrc` via `actions/setup-node`; no workflow installs unpinned global tools.

## Acceptance Criteria

- PRs and `main` pushes run lint, typecheck, coverage, browser builds, package verification, Firefox lint, Chromium E2E, and ZIP packaging.
- CI uploads LCOV and both distributable ZIPs as retained workflow artifacts.
- A successful `main` CI run creates a semantic GitHub release only when conventional commits warrant one.
- Releases include generated Chrome and Firefox ZIPs and commit the resolved semantic version without publishing to npm.
- Workflow YAML and scripts are locally validated where possible; release requires GitHub-hosted credentials to execute.
