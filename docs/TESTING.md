# Release Testing

Use Node `26.7.0` from `.nvmrc` for every release check:

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 26.7.0
npm install
npm run verify
npm run test:e2e
npm run package
```

`npm run verify` runs the automated lint, typecheck, unit tests, Chrome and Firefox builds, package inspection, and Firefox artifact lint. It does not run the manual Firefox matrix below. `npm run package` writes the distributable ZIP files after verification.

## Firefox Temporary Add-on

```sh
npm run dev:firefox
```

WXT starts Firefox with the development add-on loaded from the generated Firefox MV3 build. In that browser, open `about:debugging#/runtime/this-firefox`, confirm Cloudwatcher is listed as a temporary extension, and use its Inspect button when background diagnostics are needed. Keep the command running while testing so WXT can rebuild and reload the temporary add-on. If loading it manually, use **Load Temporary Add-on** on that page and select `.output/firefox-mv3/manifest.json` after `npm run build:firefox`.

## Manual Matrix

Do not mark this matrix complete or record a passing release until every applicable check has been manually exercised on both current Firefox ESR and current stable Firefox.

### Current Firefox ESR

- [ ] Date recorded:
- [ ] Firefox version recorded:
- [ ] Direct detection displays the overlay.
- [ ] Direct detection displays the banner when configured.
- [ ] Direct detection remains off when configured.
- [ ] Content detection displays the banner.
- [ ] Content detection remains off when configured.
- [ ] Continue dismisses the direct overlay; reload displays it again.
- [ ] Exact-host ignore suppresses only that host.
- [ ] Whole-site ignore suppresses the site.
- [ ] Browser Back navigation retains the correct notice state.
- [ ] `about:blank` fallback behaves safely.
- [ ] Custom IPv4 CIDRs are accepted and detect matching addresses.
- [ ] Custom IPv6 CIDRs are accepted and detect matching addresses.
- [ ] Header-only empty range input is accepted.
- [ ] An invalid range line is rejected without replacing saved ranges.
- [ ] Ignored and disabled detections have the expected activity counting behavior.
- [ ] Private-window detections are not added to persistent activity counts.
- [ ] Popup displays each supported detection state.
- [ ] Clearing activity removes all activity summaries.
- [ ] Layout remains usable at 200% zoom.
- [ ] All controls work with keyboard-only navigation.
- [ ] The interface remains usable in light and dark browser themes.
- [ ] Protected pages do not inject a notice and fail safely.

### Current Stable Firefox

- [ ] Date recorded:
- [ ] Firefox version recorded:
- [ ] Direct detection displays the overlay.
- [ ] Direct detection displays the banner when configured.
- [ ] Direct detection remains off when configured.
- [ ] Content detection displays the banner.
- [ ] Content detection remains off when configured.
- [ ] Continue dismisses the direct overlay; reload displays it again.
- [ ] Exact-host ignore suppresses only that host.
- [ ] Whole-site ignore suppresses the site.
- [ ] Browser Back navigation retains the correct notice state.
- [ ] `about:blank` fallback behaves safely.
- [ ] Custom IPv4 CIDRs are accepted and detect matching addresses.
- [ ] Custom IPv6 CIDRs are accepted and detect matching addresses.
- [ ] Header-only empty range input is accepted.
- [ ] An invalid range line is rejected without replacing saved ranges.
- [ ] Ignored and disabled detections have the expected activity counting behavior.
- [ ] Private-window detections are not added to persistent activity counts.
- [ ] Popup displays each supported detection state.
- [ ] Clearing activity removes all activity summaries.
- [ ] Layout remains usable at 200% zoom.
- [ ] All controls work with keyboard-only navigation.
- [ ] The interface remains usable in light and dark browser themes.
- [ ] Protected pages do not inject a notice and fail safely.

## Known Limitations

Detection can miss cached responses, responses with missing or altered Cloudflare headers, unavailable connected-IP metadata, and traffic outside the observed response path. Detection state is associated with the active tab and observed navigation, so rapid navigation, redirects, frames, restored tabs, and browser event ordering can temporarily associate metadata with a prior or incomplete navigation. Recheck these cases during release smoke testing when they are relevant to a change.

## Dev Tool Audit Exception

As of 2026-08-24, `npm audit` reports a high-severity denial-of-service advisory for `image-size@2.0.2` through the development-only `web-ext -> addons-linter -> image-size` chain. `npm audit --omit=dev` reports no production dependency vulnerabilities, and neither tool is shipped in the extension ZIPs. The exposure is limited to a developer or CI process linting an untrusted extension containing a crafted image.

`web-ext@10.6.0`, `addons-linter@10.10.0`, and `image-size@2.0.2` are the latest available upstream versions; do not apply npm's incompatible downgrade proposal. This exception is accepted through 2026-11-22. Before that date, rerun `npm audit`, `npm audit --omit=dev`, and the upstream version checks, then upgrade or remove the chain when Mozilla publishes a compatible fix.

## GitHub Automation

Pull requests and pushes to `main` run the automated release commands, including V8 coverage, and retain the LCOV report plus Chrome and Firefox ZIPs as GitHub Actions artifacts. A successful `main` CI run calculates semantic versions from Conventional Commits: `feat:` creates a minor version, `fix:` and `perf:` create a patch version, and `BREAKING CHANGE:` creates a major version. It updates the package version, creates the GitHub release, and attaches both browser ZIPs without publishing to npm.

GitHub automation does not replace the manual Firefox ESR and stable matrix above. Complete that matrix before making a release publicly available.
