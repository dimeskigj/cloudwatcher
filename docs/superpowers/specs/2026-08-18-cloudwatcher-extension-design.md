# Cloudwatcher Browser Extension Design

## Summary

Cloudwatcher is a privacy-preserving browser extension that tells users when the site they are visiting, or content embedded by that site, is served through Cloudflare. It passively observes response metadata already available to the browser. It does not block traffic, query an external detection service, send telemetry, or retain a detailed browsing log.

The first release will publish for Firefox and also produce a Chromium package from the same source tree. Firefox remains the primary release target, but browser-specific code and manifests must not fork the product behavior.

## Goals

- Detect Cloudflare from strong response-header signals and Cloudflare IPv4/IPv6 ranges.
- Show a translucent, interaction-blocking full-screen notice for a directly proxied site by default.
- Let users configure direct-site warnings as full-screen, top banner, or off.
- Show a top banner for Cloudflare-backed page content by default, with an off mode.
- Give every notice actions to continue once, leave the page, or permanently ignore the current host or whole site.
- Suppress duplicate content banners when the top-level page itself is detected.
- Show current-tab status and evidence in a toolbar popup.
- Keep local, per-site summary counts without retaining resource URLs or a detailed history.
- Let users manage the effective Cloudflare CIDR list without automatic network updates.
- Build and test Firefox and Chromium packages from one TypeScript codebase.

## Non-Goals

- Blocking, redirecting, or modifying network requests.
- Guaranteeing detection when the browser does not expose a response.
- External DNS, ASN, WHOIS, or Cloudflare API lookups.
- Automatic Cloudflare IP-range downloads.
- Telemetry, analytics, cloud synchronization, or remote code.
- Persisting full visited URLs, resource URLs, response headers, or server IPs.
- A detailed chronological browsing log.
- Firefox-only detection features that cannot map cleanly to Chromium.

## Product Defaults

| Setting | Default | Available values |
| --- | --- | --- |
| Direct-site warning | Full-screen overlay | Full-screen overlay, top banner, off |
| Page-content warning | Top banner | Top banner, off |
| Detection sources | Headers and managed IP ranges | Always active |
| Data location | Browser local storage | Local only |

Warning settings affect presentation only. Detection and non-private summary counting continue when a warning category is off or a site is ignored.

## Technical Approach

Use a passive Manifest V3 `webRequest` monitor. The background entrypoint listens to `webRequest.onResponseStarted` with response headers enabled. On current Firefox and Chromium implementations, this event provides the response headers and, when available, the actual connected server IP without requiring a blocking listener.

The implementation stack is:

- TypeScript for all extension code.
- WXT for cross-browser entrypoints, development, and Firefox/Chromium builds.
- Preact for the notice, popup, and options interfaces.
- Pure TypeScript modules for classification, domain matching, navigation state, and storage schemas.
- A bundled public-suffix implementation such as `tldts` for portable registrable-domain handling.

WXT will generate browser-appropriate Manifest V3 background declarations from shared source. The extension will request only the permissions needed to observe responses, inject notices, store local state, inspect the active tab, and navigate back or to `about:blank`. Host access is limited to schemes the product supports: HTTP, HTTPS, WS, and WSS where the browser permits response observation.

## Architecture

### Background Monitor

The background monitor owns browser event registration and orchestration. It:

- Observes response-started events for supported URLs.
- Ignores browser/extension pages, requests with `tabId === -1`, and requests that cannot be associated with a visible tab.
- Resets navigation state when a new top-level network navigation begins.
- Classifies each observed response through the detection core.
- Applies notice modes and shared ignore rules.
- Records direct and content summary events at most once per navigation.
- Sends notice state to the top-frame content script.
- Answers popup queries for the active tab.
- Handles continue, permanent-ignore, and leave-page commands.
- Removes stale state when a tab closes.

Browser listeners are registered synchronously at module startup so they survive event-page or service-worker lifecycle changes.

### Detection Core

The detection core is browser-independent. Given normalized response metadata and a CIDR set, it returns either no match or a structured match containing fixed evidence labels. It never reads storage or calls a browser API.

Strong header evidence is case-insensitive and includes:

- Presence of `cf-ray`.
- Presence of `cf-cache-status`.
- Presence of `cf-mitigated`.
- A `server` value that identifies Cloudflare.

An IP match is positive when the connected IPv4 or IPv6 address belongs to an enabled CIDR. Header evidence and IP evidence are independent; either one is sufficient. Unknown `cf-*` headers are not treated as positive without being explicitly added to the classifier.

Header names, not untrusted raw values, are used in user-facing evidence. A matched IP may be shown in the current-tab popup but is never persisted.

### Navigation Coordinator

The navigation coordinator maintains a record keyed by tab and current network navigation. The record contains:

- Current top-level URL and canonical hostname.
- Direct-detection state and evidence.
- Content-detection state, first detected resource host, and evidence.
- Whether each category has been counted.
- Which notice, if any, was shown or dismissed for this navigation.

The working cache is backed by `storage.session`, not persistent local storage. This allows state to survive Chromium service-worker suspension while disappearing when the browser session ends. A new main-frame network navigation replaces the previous record. Single-page-app history changes do not create a new count or re-arm a dismissed notice unless they cause a main-frame network navigation.

The content script performs a startup handshake. The background returns current notice state when detection happened before the content script was ready. Messages include enough navigation identity to prevent a late message from rendering on the next page.

### Content Notice

One content script runs in the top frame of supported web pages. It mounts one fixed host element with a closed Shadow DOM and renders either the overlay or banner. Shadow DOM and explicit style resets isolate the interface from page CSS. Page-provided values are inserted as text, never HTML.

The content script contains presentation and interaction wiring only. It does not classify responses, decide ignore matches, or write summary data.

### Local Repository

A single repository module wraps `storage.local` and `storage.session`. No UI or monitor code accesses storage directly. It provides typed reads, schema validation, migrations, canonical writes, and a serialized update queue.

The queue prevents lost increments when multiple tabs update the same summary concurrently. Invalid stored entries are excluded from active use but preserved for recovery and reported in the options interface. A failed write leaves the previously stored value intact.

### Popup And Options

The popup and options page communicate through typed background messages and repository interfaces. They do not duplicate detection, ignore matching, or migration logic.

## Detection And Event Semantics

### Direct Sites

A positive `main_frame` response marks the visited site as directly proxied through Cloudflare. The direct-site mode determines whether Cloudwatcher shows an overlay, banner, or no notice.

### Page Content

Any other positive response associated by the browser with the tab counts as page content. This includes subframes, images, scripts, stylesheets, fonts, media, fetch/XHR, beacons, WebSocket handshakes, and other resource types exposed through `webRequest`.

Cloudwatcher shows at most one content banner per navigation. Additional detections may update ephemeral evidence but do not re-open a dismissed banner. Requests that a service worker or browser process does not associate with a tab cannot be safely attributed and are ignored.

### Priority

Direct detection always suppresses the separate content banner for that navigation. This remains true when the direct-site warning mode is off. Direct and content summary counts remain independent, so both can increment once when both kinds of response are detected.

If an unusual event ordering produces a content banner before direct detection, direct detection removes or replaces it according to the configured direct-site mode.

### Counting

Persistent summaries are keyed by the visited page's registrable domain, not by resource domain. Each summary stores only:

```ts
type DomainSummary = {
  directNavigations: number;
  contentNavigations: number;
  lastSeenAt: string;
};
```

Each counter increments at most once per main-frame network navigation. `lastSeenAt` is the latest positive detection in either category. Ignored sites and disabled warning modes still count. Private-window detections do not persist counts.

## IP Range Management

The extension ships a reviewed Cloudflare IPv4/IPv6 list. On first install, that list seeds a user-managed effective CIDR list in `storage.local`. Extension upgrades never silently overwrite the user's effective list.

The options page presents one CIDR per line. Blank lines are ignored. Import replaces the editor draft, and reset loads the defaults bundled with the currently installed extension into the draft. Neither action changes active detection until the user saves. Export downloads the currently saved effective list as plain text.

Saving is atomic. Every entry must be a valid IPv4 or IPv6 CIDR. The parser canonicalizes network addresses, normalizes prefix notation, removes duplicates, and reports errors by line. If any line is invalid, nothing is saved. An intentionally empty list is allowed and produces header-only detection.

There is no automatic or manual network fetch. Updating from newer Cloudflare-published ranges requires an extension release or a user import/edit.

## Ignore Rules

A permanent ignore rule suppresses both direct-site and page-content notices while the user visits a matching site. It does not stop monitoring or summary counting.

From a host such as `shop.example.co.uk`, the permanent-dismiss flow offers:

- Exact host: `shop.example.co.uk` only.
- Whole site: `example.co.uk` and every subdomain, including the apex itself.

Whole-site matching uses the bundled public-suffix data rather than assuming the last two labels form a registrable domain. Rules are stored as canonical lowercase ASCII hostnames with an explicit `host` or `site` scope. The options page displays human-readable labels and lets the user remove rules.

New ignore rules immediately close a matching visible notice. Removing a rule re-enables warnings on the next main-frame network navigation; it does not retroactively show a notice on an already loaded page.

## Notice Experience

### Visual Direction

Cloudwatcher should feel like a calm monitoring instrument, not a generic alert box or an alarm screen. Use dark ink/porcelain neutrals, a restrained signal-orange accent, crisp evidence labels, and concise language. Motion is brief and functional. Both extension pages and injected notices support light and dark browser preferences, reduced motion, zoom, and narrow viewports.

### Full-Screen Direct Notice

The default direct-site notice is a fixed, translucent full-viewport layer. The page remains visible and continues loading underneath, but the layer blocks pointer and keyboard interaction until the user makes a choice.

The focused dialog says that Cloudflare was detected for the site and names the current hostname. It offers:

- **Continue once:** dismiss for this navigation only.
- **Go back:** navigate to the previous history entry; if no usable entry exists or the operation fails, replace the tab with `about:blank`.
- **Don't warn here again:** reveal the exact-host and whole-site choices before saving a rule and closing the notice.

Escape is equivalent to **Continue once**. The overlay uses modal semantics, traps focus, restores focus when practical, prevents focus from reaching the page behind it, and exposes all controls to keyboard and assistive technology.

### Banner

The direct banner mode and default page-content warning use a fixed banner at the top of the viewport. It overlays rather than mutates or shifts the site's layout. It provides the same three actions and permanent-rule chooser as the overlay, but it does not block interaction with the rest of the page or steal focus when it appears.

Direct copy identifies the current host. Content copy says the page loads content through Cloudflare and identifies the first detected resource hostname, never its full URL. Controls wrap into a readable stacked layout on narrow viewports.

### Live Setting Changes

Changing a mode to off closes matching visible notices. New ignore rules also close matching notices. Enabling a warning mode or removing an ignore rule does not unexpectedly warn on an already loaded page; the change applies from the next main-frame network navigation. CIDR changes affect newly observed responses and do not reclassify already completed requests.

### Accessibility

- WCAG AA text and control contrast.
- Visible focus indicators and logical focus order.
- Correct dialog, status, heading, and button semantics.
- Keyboard access to all actions and the permanent-rule chooser.
- No information conveyed by color alone.
- Reduced-motion behavior with no essential animation.
- Notice layout that remains usable at 200% zoom and mobile-width viewports.

## Toolbar Popup

The popup reports one current-tab detection state:

- Direct Cloudflare proxy detected.
- Cloudflare-backed content detected.
- No Cloudflare observed during the current navigation.
- Detection present but notices suppressed by an ignore rule.
- Unavailable on a protected, browser-internal, unsupported, or otherwise inaccessible page.

When detection exists, the popup shows fixed evidence labels, the detected resource host when relevant, and the visited site's direct/content summary counts. Suppression is shown as a secondary status without hiding the underlying detection. The popup links to the relevant options view and does not expose a detailed request list.

## Options Page

The options page has four focused views:

1. **Warnings:** direct overlay/banner/off and content banner/off controls, with concise behavior explanations.
2. **Ignored sites:** searchable shared rules with scope labels and remove actions.
3. **IP ranges:** effective-list editor, validation, import, export, reset-to-bundled draft, and save.
4. **Activity:** per-registrable-domain direct count, content count, and last seen, with a clear-all action.

Destructive actions require confirmation. Storage or validation failures remain on screen with a recovery path and do not discard the user's draft.

## Data And Privacy

Persistent local data has a schema version and four logical records:

```ts
type Settings = {
  directNoticeMode: "overlay" | "banner" | "off";
  contentNoticeMode: "banner" | "off";
};

type IgnoreRule = {
  scope: "host" | "site";
  value: string;
};

type StoredState = {
  schemaVersion: number;
  settings: Settings;
  ignoreRules: IgnoreRule[];
  ipRanges: string[];
  summaries: Record<string, DomainSummary>;
};
```

The physical storage layout may use separate keys to make updates safer, but behavior must match this logical schema. Ephemeral session state is separate and may contain current URLs, evidence, and IPs only for the active browser session.

There is no use of `storage.sync`. There are no extension-originated network requests in normal operation. If the user grants private-window access, detection and notices work there, but persistent activity summaries are skipped. A permanent ignore selected by the user in a private window is stored because it is an explicit settings action.

The store listing and privacy documentation must explain the broad host permission, exactly what is observed, what is retained, known blind spots, and how to clear all persisted activity.

## Error Handling

- Missing response headers or server IP: classify using the evidence that is available; do not fail the request.
- Invalid user CIDRs: show line-level errors and preserve the active saved list.
- Content-script messaging failure: retain tab state for handshake where possible; otherwise expose an unavailable status without repeated errors.
- Protected/browser page: do not inject; popup reports unavailable.
- No usable browser history: replace the current tab with `about:blank`.
- Local-storage write failure: keep prior data, report the operation failure, and allow retry.
- Invalid persisted schema entry: exclude only the invalid entry, preserve it for recovery, and show a settings diagnostic.
- Service-worker/event-page restart: reconstruct current navigation state from `storage.session`.
- Tab close or replacement: remove stale session state.

## Known Limitations

- Chromium may not expose requests fulfilled from its in-memory cache to `webRequest`.
- Servers can strip or omit Cloudflare-identifying headers.
- Browser APIs may omit the connected IP for some response types.
- Requests without a tab association cannot be attributed to a visited page.
- A stale or user-modified CIDR list can cause false negatives or false positives.
- The extension reports evidence observed by the browser; it cannot prove the complete network path.

Cloudwatcher must describe results as "detected" or "not observed," never claim that an unflagged site definitively does not use Cloudflare.

## Testing Strategy

### Unit Tests

- Header-name and server-value normalization, including case variations.
- Positive and negative header combinations.
- IPv4 and IPv6 CIDR boundaries, canonicalization, deduplication, and malformed input.
- Exact-host and whole-site matching, including multi-label public suffixes.
- Summary increments and once-per-navigation guards.
- Storage schemas and migrations.

### Background Integration Tests

Use mocked WebExtension events and storage to cover:

- Direct and page-content detection.
- Header-only, IP-only, and combined evidence.
- Direct-notice priority over content banners.
- Overlay, banner, and off modes.
- One-time and permanent dismissal.
- Ignored/disabled presentation with continued non-private counting.
- Main-frame navigation reset and late content-script handshake.
- Unusual content-before-direct ordering.
- Concurrent summary writes.
- Session-state restoration after background restart.
- Private browsing behavior.
- History success and `about:blank` fallback.
- Protected-page and messaging failures.

### UI And Accessibility Tests

- Overlay and banner copy and actions.
- Permanent-dismiss exact-host and whole-site chooser.
- Focus trap, focus restoration, Escape behavior, and keyboard order.
- Banner non-interference with page focus.
- Popup state and evidence variants.
- Options drafts, validation, confirmation, and recovery errors.
- Reduced motion, light/dark modes, narrow layouts, and 200% zoom.
- Automated accessibility checks on each UI state.

### Browser And Build Tests

- Local fixture pages emit controlled Cloudflare-like headers and load controlled subresources.
- Chromium runs an automated unpacked-extension smoke suite.
- Firefox runs the same acceptance scenarios with a temporary `web-ext` profile and passes `web-ext lint`.
- Type checking, linting, unit/integration/UI tests, and production builds run for both targets.
- Generated manifests and packages are inspected for expected permissions, remote code, and unexpected network endpoints.

The compatibility policy is the current Firefox ESR plus current stable Firefox and Chromium at release time.

## Acceptance Criteria

1. A direct header or IP match shows the default interaction-blocking translucent overlay.
2. Direct mode can be changed to top banner or off.
3. Any tab-associated Cloudflare subresource can trigger one content banner when direct detection is absent.
4. Direct detection suppresses the content banner while preserving independent counts.
5. Continue dismisses only for the current navigation; reload can warn again.
6. Permanent dismissal offers the exact current host or registrable site plus all subdomains and suppresses both warning categories.
7. Go back uses history and falls back to `about:blank`.
8. Managed IPv4/IPv6 ranges can be validated, edited, imported, exported, emptied, and reset without an automatic fetch.
9. The popup shows current detection, evidence, suppression state, and local summary counts.
10. Activity stores only registrable-domain counts and last-seen timestamps and can be cleared.
11. Ignored and globally suppressed detections still count outside private windows.
12. Private-window detections never persist activity counts.
13. Notices and extension pages meet the stated keyboard, contrast, reduced-motion, zoom, and responsive requirements.
14. Firefox and Chromium packages build from the same source and pass their verification suites.
15. No normal operation sends telemetry, performs an external lookup, or downloads IP ranges.
