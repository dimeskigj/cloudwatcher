# Privacy

Cloudwatcher detects Cloudflare delivery from response headers and the connected IP address's match against locally stored CIDR ranges. It passively observes responses and does not modify network traffic.

## Data handling

Cloudwatcher does not collect telemetry, perform remote lookups, fetch ranges automatically, execute remote code, or synchronize data. All data remains in the browser's extension storage.

`storage.local` persistently stores:

- `schemaVersion`.
- Notice settings: direct-navigation and content-resource notice modes.
- Ignore rules: each rule's host-or-site scope and hostname value.
- Cloudflare IP CIDR ranges, initially the bundled defaults and subsequently any user-saved list.
- Activity summaries keyed by site: direct and content detection counts, plus the most recent detection timestamp.

`storage.session` stores active per-tab navigation state only. It can include the tab and request identifiers, navigation identifier, top-level URL, host/site identity, private-window flag, matching response-header evidence, connected IP address and matching CIDR, content resource host, notice/count/dismissal state, and the navigation's ignore-rule snapshot. This state is removed when a tab closes and is not persistent activity history.

## Private windows

Cloudwatcher can detect and show notices in private windows when the browser permits the extension there. Private-window detections are not added to persistent activity counts. Settings, CIDR lists, and any ignore rule explicitly chosen by the user are shared local extension settings and can still be changed from a private window.

## Permissions

The all-sites host permission lets Cloudwatcher inspect eligible HTTP(S), WebSocket, and secure WebSocket responses on the sites you visit; it cannot know in advance which site uses Cloudflare. The `webRequest` permission supplies response headers and connected IP metadata for that passive check. `tabs` identifies the active tab for popup status, and `storage` saves the settings described above.

## Limits and controls

Detection is not a guarantee. Cached responses, missing or altered headers, unavailable connected-IP data, and traffic outside the observed response path can cause false negatives. User-managed CIDR ranges can cause false positives if they include addresses not serving Cloudflare traffic. Ignoring a host or site explicitly suppresses Cloudwatcher notices for that choice; it does not change the site's traffic or prove the site is not using Cloudflare.

The Activity settings control clears all persistent per-site summaries and timestamps. It does not clear notice settings, ignore rules, or CIDR ranges. Session navigation state is cleared when its tab closes.
