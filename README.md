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

## IP management

Cloudwatcher starts with bundled Cloudflare CIDR ranges. In Options, you can replace the range list with your own valid CIDRs. It never looks up or automatically fetches ranges. You can also explicitly ignore a host or its site; this suppresses Cloudwatcher notices without changing network traffic.

## Known limitations

Detection depends on observed response headers and connected IP metadata. Cached responses, missing or altered headers, unavailable IP data, and unobserved response paths can cause false negatives. User-managed CIDR ranges can cause false positives.

## Privacy

See [the privacy guide](docs/PRIVACY.md) for permissions, local and session storage, private-window handling, and activity clearing.
