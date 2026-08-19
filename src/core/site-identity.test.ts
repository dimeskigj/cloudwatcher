import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./model";
import {
  canonicalizeHostname,
  getIgnoreChoices,
  getSiteIdentity,
  isIgnored,
  matchesIgnoreRule,
} from "./site-identity";

describe("hostname canonicalization", () => {
  it("canonicalizes lowercase ASCII and IDNA domain names", () => {
    expect(canonicalizeHostname("BÜCHER.Example.")).toBe("xn--bcher-kva.example");
  });

  it("normalizes IPv4 and bracketed IPv6 addresses", () => {
    expect(canonicalizeHostname("192.0.2.10")).toBe("192.0.2.10");
    expect(canonicalizeHostname("[2001:0DB8:0:0:0:0:0:1]")).toBe("2001:db8::1");
  });

  it.each(["constructor", "__proto__"])("accepts the browser-safe hostname %s", (hostname) => {
    expect(canonicalizeHostname(hostname)).toBe(hostname);
  });

  it.each([
    "https://example.com",
    "example.com/path",
    "example.com:443",
    " example.com",
    "example .com",
    "user@example.com",
    "example.com?query",
    "example.com#fragment",
  ])("rejects non-hostname payload %s", (hostname) => {
    expect(() => canonicalizeHostname(hostname)).toThrow(/hostname/i);
  });
});

describe("site identity", () => {
  it("uses the registrable domain for a multi-label public suffix", () => {
    expect(getSiteIdentity("https://shop.example.co.uk/cart")).toEqual({
      hostname: "shop.example.co.uk",
      siteKey: "example.co.uk",
      registrableDomain: "example.co.uk",
    });
  });

  it("includes private suffixes when finding the registrable domain", () => {
    expect(getSiteIdentity("https://team.github.io/")).toEqual({
      hostname: "team.github.io",
      siteKey: "team.github.io",
      registrableDomain: "team.github.io",
    });
  });

  it.each([
    ["http://localhost:3000/", "localhost"],
    ["http://192.0.2.10:8080/", "192.0.2.10"],
    ["https://[2001:db8::1]/", "2001:db8::1"],
  ])("falls back to the canonical hostname for %s", (url, hostname) => {
    expect(getSiteIdentity(url)).toEqual({ hostname, siteKey: hostname });
  });

  it("lowercases hostnames and removes trailing dots", () => {
    expect(getSiteIdentity("https://SHOP.EXAMPLE.COM./")).toEqual({
      hostname: "shop.example.com",
      siteKey: "example.com",
      registrableDomain: "example.com",
    });
  });
});

describe("ignore rules", () => {
  it("matches host rules only against the exact hostname", () => {
    const rule = { scope: "host", value: "shop.example.co.uk" } as const;

    expect(matchesIgnoreRule("shop.example.co.uk", rule)).toBe(true);
    expect(matchesIgnoreRule("api.shop.example.co.uk", rule)).toBe(false);
  });

  it("matches site rules against the site and its subdomains on label boundaries", () => {
    const rule = { scope: "site", value: "example.co.uk" } as const;

    expect(matchesIgnoreRule("example.co.uk", rule)).toBe(true);
    expect(matchesIgnoreRule("api.example.co.uk", rule)).toBe(true);
    expect(matchesIgnoreRule("notexample.co.uk", rule)).toBe(false);
  });

  it("reports whether any rule ignores an identity", () => {
    const identity = getSiteIdentity("https://shop.example.co.uk");

    expect(isIgnored(identity, [{ scope: "site", value: "example.co.uk" }])).toBe(true);
    expect(isIgnored(identity, [{ scope: "host", value: "api.example.co.uk" }])).toBe(false);
  });

  it("offers exact-host and whole-site choices for registrable domains", () => {
    expect(getIgnoreChoices(getSiteIdentity("https://shop.example.co.uk"))).toEqual([
      {
        label: "shop.example.co.uk only",
        rule: { scope: "host", value: "shop.example.co.uk" },
      },
      {
        label: "example.co.uk and all subdomains",
        rule: { scope: "site", value: "example.co.uk" },
      },
    ]);
  });

  it("offers only an exact-host choice without a registrable domain", () => {
    expect(getIgnoreChoices(getSiteIdentity("http://localhost:3000/"))).toEqual([
      { label: "localhost only", rule: { scope: "host", value: "localhost" } },
    ]);
  });
});

describe("default settings", () => {
  it("uses overlay direct notices and banner content notices", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      directNoticeMode: "overlay",
      contentNoticeMode: "banner",
    });
  });
});
