# CI Validation Design

## Scope

Repair the failed release-automation CI run and remove its related Biome deprecation warning without changing extension behavior.

## Changes

- Reformat `scripts/verify-package.mjs` with the repository's pinned Biome formatter.
- Replace Biome's deprecated `linter.rules.recommended` setting with the supported recommended preset.
- Validate the full CI command sequence with Node 26.7.0, including linting, type checking, unit tests, builds, artifact verification, Firefox linting, E2E tests, packaging, and coverage.

## Non-Goals

- Change extension functionality or test expectations.
- Alter CI workflow triggers, permissions, release automation, or dependency versions.
