import { describe, expect, it } from "vitest";
import { canonicalizeHostname } from "./hostname";

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
