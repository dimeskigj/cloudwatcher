import { describe, expect, it } from "vitest";
import { compileCidrs, matchIp, validateCidrText } from "./cidr";
import { DEFAULT_CIDRS } from "./default-ranges";

describe("default CIDRs", () => {
  it("contains the reviewed Cloudflare IPv4 and IPv6 ranges", () => {
    expect(DEFAULT_CIDRS).toEqual([
      "173.245.48.0/20",
      "103.21.244.0/22",
      "103.22.200.0/22",
      "103.31.4.0/22",
      "141.101.64.0/18",
      "108.162.192.0/18",
      "190.93.240.0/20",
      "188.114.96.0/20",
      "197.234.240.0/22",
      "198.41.128.0/17",
      "162.158.0.0/15",
      "104.16.0.0/13",
      "104.24.0.0/14",
      "172.64.0.0/13",
      "131.0.72.0/22",
      "2400:cb00::/32",
      "2606:4700::/32",
      "2803:f800::/32",
      "2405:b500::/32",
      "2405:8100::/32",
      "2a06:98c0::/29",
      "2c0f:f248::/32",
    ]);
  });
});

describe("CIDR validation", () => {
  it("masks host bits and deduplicates canonical networks", () => {
    const result = validateCidrText("104.16.1.7/13\n2606:4700:1234::1/32\n104.16.0.0/13");

    expect(result.errors).toEqual([]);
    expect(result.values).toEqual(["104.16.0.0/13", "2606:4700::/32"]);
    expect(result.compiled.map(({ text, kind, prefix }) => ({ text, kind, prefix }))).toEqual([
      { text: "104.16.0.0/13", kind: "ipv4", prefix: 13 },
      { text: "2606:4700::/32", kind: "ipv6", prefix: 32 },
    ]);
  });

  it("ignores blank lines and accepts blank input", () => {
    expect(validateCidrText(" \n\t\n")).toEqual({ values: [], compiled: [], errors: [] });

    const result = validateCidrText("\n  192.0.2.129/24  \n\n");
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual(["192.0.2.0/24"]);
  });

  it("reports each invalid nonblank line and withholds partial compiled results", () => {
    const result = validateCidrText("192.0.2.0/24\nnot-a-cidr\n\n10.0.0.0/33");

    expect(result.values).toEqual(["192.0.2.0/24"]);
    expect(result.compiled).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ line: 2, input: "not-a-cidr" });
    expect(result.errors[0]?.message).toEqual(expect.any(String));
    expect(result.errors[1]).toMatchObject({ line: 4, input: "10.0.0.0/33" });
    expect(result.errors[1]?.message).toEqual(expect.any(String));
  });

  it("compiles readonly values into canonical, deduplicated networks", () => {
    const values = ["203.0.113.255/24", "203.0.113.0/24", "2001:db8:abcd::1/32"] as const;

    expect(compileCidrs(values).map(({ text }) => text)).toEqual([
      "203.0.113.0/24",
      "2001:db8::/32",
    ]);
  });

  it("rejects invalid values when compiling trusted CIDR lists", () => {
    expect(() => compileCidrs(["192.0.2.0/24", "invalid"])).toThrow();
  });
});

describe("CIDR matching", () => {
  it("matches IPv4 addresses at the network boundaries only", () => {
    const ranges = compileCidrs(["104.16.1.7/13"]);

    expect(matchIp("104.16.0.0", ranges)?.text).toBe("104.16.0.0/13");
    expect(matchIp("104.23.255.255", ranges)?.text).toBe("104.16.0.0/13");
    expect(matchIp("104.15.255.255", ranges)).toBeUndefined();
    expect(matchIp("104.24.0.0", ranges)).toBeUndefined();
  });

  it("matches IPv6 addresses at the network boundaries only", () => {
    const ranges = compileCidrs(["2606:4700:1234::1/32"]);

    expect(matchIp("2606:4700::", ranges)?.text).toBe("2606:4700::/32");
    expect(matchIp("2606:4700:ffff:ffff:ffff:ffff:ffff:ffff", ranges)?.text).toBe("2606:4700::/32");
    expect(matchIp("2606:46ff:ffff:ffff:ffff:ffff:ffff:ffff", ranges)).toBeUndefined();
    expect(matchIp("2606:4701::", ranges)).toBeUndefined();
  });

  it("normalizes IPv4-mapped IPv6 addresses before matching", () => {
    const ranges = compileCidrs(["104.16.0.0/13", "::/0"]);

    expect(matchIp("::ffff:104.16.4.3", ranges)?.text).toBe("104.16.0.0/13");
    expect(matchIp("::ffff:104.32.0.0", ranges)).toBeUndefined();
  });

  it("returns no match for invalid addresses", () => {
    expect(matchIp("not-an-ip", compileCidrs(["0.0.0.0/0", "::/0"]))).toBeUndefined();
  });
});
