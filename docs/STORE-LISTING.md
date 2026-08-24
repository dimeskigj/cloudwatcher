# Store Listing

## Short description

See when a site or page content is served through Cloudflare.

## Full description

Cloudwatcher passively checks response headers and connected IP addresses against local CIDR ranges, then shows a notice when it finds Cloudflare delivery for a top-level site or its page content. It does not modify web traffic.

All-sites access is required because Cloudwatcher cannot know which sites use Cloudflare before you visit them. The `webRequest` permission provides the response headers and connected IP information needed for its passive detection. The extension stores notice settings, explicit host/site ignore rules, user-managed CIDR ranges, and per-site direct/content detection counts with their latest timestamp. Active tab URLs, response evidence, connected IP addresses, and CIDR matches are session-only navigation state.

Detection can miss cached responses, missing or altered headers, unavailable IP metadata, or responses outside the observed path. User-managed ranges can also produce false positives. You can explicitly ignore a host or site, and clear retained activity summaries without clearing your settings, ignores, or ranges.

Cloudwatcher has no telemetry, remote lookups, automatic range fetches, sync, or remote code. For support or feedback, use the [repository issue tracker](https://github.com/dimeskigj/cloudwatcher/issues).

Cloudwatcher is an independent project and is not affiliated with or endorsed by Cloudflare.
