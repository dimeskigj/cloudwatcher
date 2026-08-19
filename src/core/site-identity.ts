import { getDomain } from "tldts";
import { canonicalizeHostname } from "./hostname";
import type { IgnoreChoice, IgnoreRule, SiteIdentity } from "./model";

export { canonicalizeHostname } from "./hostname";

export function getSiteIdentity(url: string): SiteIdentity {
  const hostname = canonicalizeHostname(new URL(url).hostname);
  const registrableDomain = getDomain(hostname, { allowPrivateDomains: true }) ?? undefined;

  if (registrableDomain === undefined) {
    return { hostname, siteKey: hostname };
  }

  return {
    hostname,
    siteKey: registrableDomain,
    registrableDomain,
  };
}

export function matchesIgnoreRule(hostname: string, rule: IgnoreRule): boolean {
  if (rule.scope === "host") {
    return hostname === rule.value;
  }

  return hostname === rule.value || hostname.endsWith(`.${rule.value}`);
}

export function isIgnored(identity: SiteIdentity, rules: readonly IgnoreRule[]): boolean {
  return rules.some((rule) => matchesIgnoreRule(identity.hostname, rule));
}

export function getIgnoreChoices(identity: SiteIdentity): IgnoreChoice[] {
  const hostChoice: IgnoreChoice = {
    label: `${identity.hostname} only`,
    rule: { scope: "host", value: identity.hostname },
  };

  if (identity.registrableDomain === undefined) {
    return [hostChoice];
  }

  return [
    hostChoice,
    {
      label: `${identity.registrableDomain} and all subdomains`,
      rule: { scope: "site", value: identity.registrableDomain },
    },
  ];
}
