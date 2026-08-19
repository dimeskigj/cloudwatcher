import { describe, expect, it } from "vitest";
import { compileCidrs } from "./cidr";
import { DEFAULT_CIDRS } from "./default-ranges";
import { detectCloudflare } from "./detection";

describe("Cloudflare response classification", () => {
  it.each([
    ["CF-Ray", "abc", "cf-ray"],
    ["cf-cache-status", "HIT", "cf-cache-status"],
    ["CF-Mitigated", "challenge", "cf-mitigated"],
  ] as const)("recognizes the exact %s header", (name, value, signal) => {
    expect(detectCloudflare({ responseHeaders: [{ name, value }], ranges: [] })).toEqual({
      evidence: [{ kind: "header", signal }],
    });
  });

  it.each(["cloudflare", "cloudflare-nginx"])(
    "recognizes the exact normalized server value %s",
    (value) => {
      expect(
        detectCloudflare({
          responseHeaders: [{ name: " Server ", value: ` ${value.toUpperCase()} ` }],
          ranges: [],
        }),
      ).toEqual({ evidence: [{ kind: "header", signal: "server: cloudflare" }] });
    },
  );

  it.each([
    [{ name: "Server", value: "cloudflare-ish" }],
    [{ name: "Server", value: "cloudflare nginx" }],
    [{ name: "cf-random", value: "x" }],
    [{ name: "cf-ray-extra", value: "x" }],
  ])("rejects lookalike header %#", (header) => {
    expect(detectCloudflare({ responseHeaders: [header], ranges: [] })).toBeNull();
  });

  it("deduplicates header evidence labels while preserving signal order", () => {
    expect(
      detectCloudflare({
        responseHeaders: [
          { name: "CF-Ray", value: "first" },
          { name: "cf-ray", value: "second" },
          { name: "Server", value: "cloudflare" },
          { name: "server", value: "cloudflare-nginx" },
          { name: "CF-Cache-Status", value: "HIT" },
        ],
        ranges: [],
      }),
    ).toEqual({
      evidence: [
        { kind: "header", signal: "cf-ray" },
        { kind: "header", signal: "server: cloudflare" },
        { kind: "header", signal: "cf-cache-status" },
      ],
    });
  });

  it("appends matching IP evidence after header evidence", () => {
    expect(
      detectCloudflare({
        responseHeaders: [{ name: "CF-Ray", value: "abc" }],
        ip: "104.16.4.3",
        ranges: compileCidrs(DEFAULT_CIDRS),
      }),
    ).toEqual({
      evidence: [
        { kind: "header", signal: "cf-ray" },
        { kind: "ip", ip: "104.16.4.3", cidr: "104.16.0.0/13" },
      ],
    });
  });

  it("classifies IPv4-mapped response addresses against IPv4 defaults", () => {
    expect(
      detectCloudflare({ ip: "::ffff:104.16.4.3", ranges: compileCidrs(DEFAULT_CIDRS) }),
    ).toEqual({
      evidence: [{ kind: "ip", ip: "::ffff:104.16.4.3", cidr: "104.16.0.0/13" }],
    });
  });

  it("returns null without recognized header or IP evidence", () => {
    expect(detectCloudflare({ ranges: [] })).toBeNull();
    expect(
      detectCloudflare({
        responseHeaders: [{ name: "Content-Type", value: "text/html" }],
        ip: "not-an-ip",
        ranges: compileCidrs(DEFAULT_CIDRS),
      }),
    ).toBeNull();
  });
});
