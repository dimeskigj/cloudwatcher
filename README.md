# Cloudwatcher

Cloudwatcher passively identifies when a site or page content is served through Cloudflare. It is an independent project and is not affiliated with or endorsed by Cloudflare.

## Install

Install the packaged extension from its supported browser store when available. For a local build, use the development commands below.

## Development

Cloudwatcher supports Chromium and Firefox Manifest V3 builds. Use Node `26.7.0` from `.nvmrc`.

```sh
npm install
npm run icons
npm run dev
npm run dev:firefox
```

`npm run dev` starts the Chromium development build; `npm run dev:firefox` starts the Firefox development build. Use the browser session opened by WXT for temporary local loading.

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run build` produces both Chromium and Firefox builds. Run `npm run icons` after changing `public/icon-source.svg` to regenerate all required extension icons.

## Release verification

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 26.7.0
npm install
npm run verify
npm run test:coverage
npm run test:e2e
npm run package
```

See [the release testing matrix](docs/TESTING.md) for the required manual Firefox ESR and stable testing before publishing.

GitHub Actions runs these checks for pull requests and `main` updates, retaining LCOV coverage and browser ZIPs as workflow artifacts. Semantic GitHub releases are created after successful `main` CI runs: use Conventional Commits (`feat:`, `fix:`, `perf:`, or a `BREAKING CHANGE:` footer) to select the next version. Releases update the package version, create a GitHub release, and attach Chromium and Firefox ZIPs; Cloudwatcher is not published to npm.

## IP management

Cloudwatcher starts with bundled Cloudflare CIDR ranges. In Options, you can replace the range list with your own valid CIDRs. It never looks up or automatically fetches ranges. You can also explicitly ignore a host or its site; this suppresses Cloudwatcher notices without changing network traffic.

## Known limitations

Detection depends on observed response headers and connected IP metadata. Cached responses, missing or altered headers, unavailable IP data, and unobserved response paths can cause false negatives. User-managed CIDR ranges can cause false positives.

## Privacy

See [the privacy guide](docs/PRIVACY.md) for permissions, local and session storage, private-window handling, and activity clearing.
