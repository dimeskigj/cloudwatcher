import ipaddr from "ipaddr.js";

export interface CidrError {
  line: number;
  input: string;
  message: string;
}

export interface CompiledCidr {
  text: string;
  kind: "ipv4" | "ipv6";
  address: ipaddr.IPv4 | ipaddr.IPv6;
  prefix: number;
}

export interface CidrValidation {
  values: string[];
  compiled: CompiledCidr[];
  errors: CidrError[];
}

function compileCidr(value: string): CompiledCidr {
  const [parsedAddress, prefix] = ipaddr.parseCIDR(value);
  const networkBytes = parsedAddress.toByteArray().map((byte, index) => {
    const networkBits = Math.max(0, Math.min(8, prefix - index * 8));
    const mask = networkBits === 0 ? 0 : 0xff << (8 - networkBits);
    return byte & mask;
  });
  const address = ipaddr.fromByteArray(networkBytes);

  return {
    text: `${address.toString()}/${prefix}`,
    kind: address.kind(),
    address,
    prefix,
  };
}

export function compileCidrs(values: readonly string[]): CompiledCidr[] {
  const compiledByText = new Map<string, CompiledCidr>();

  for (const value of values) {
    const compiled = compileCidr(value.trim());
    compiledByText.set(compiled.text, compiled);
  }

  return [...compiledByText.values()];
}

export function validateCidrText(text: string): CidrValidation {
  const values: string[] = [];
  const compiled: CompiledCidr[] = [];
  const errors: CidrError[] = [];
  const seen = new Set<string>();

  for (const [index, line] of text.split("\n").entries()) {
    const input = line.trim();

    if (input === "") {
      continue;
    }

    try {
      const range = compileCidr(input);

      if (!seen.has(range.text)) {
        seen.add(range.text);
        values.push(range.text);
        compiled.push(range);
      }
    } catch (error) {
      errors.push({
        line: index + 1,
        input,
        message: error instanceof Error ? error.message : "Invalid CIDR",
      });
    }
  }

  return {
    values,
    compiled: errors.length === 0 ? compiled : [],
    errors,
  };
}

export function matchIp(ip: string, ranges: readonly CompiledCidr[]): CompiledCidr | undefined {
  try {
    const parsedAddress = ipaddr.parse(ip.trim());
    const address =
      parsedAddress instanceof ipaddr.IPv6 && parsedAddress.isIPv4MappedAddress()
        ? parsedAddress.toIPv4Address()
        : parsedAddress;

    return ranges.find(
      (range) => range.kind === address.kind() && address.match(range.address, range.prefix),
    );
  } catch {
    return undefined;
  }
}
