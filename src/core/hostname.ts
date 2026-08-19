import ipaddr from "ipaddr.js";

export function canonicalizeHostname(hostname: string): string {
  if (hostname.length === 0 || /[\s/@\\?#%]/.test(hostname)) {
    throw new TypeError("Invalid hostname");
  }

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    try {
      const address = ipaddr.parse(hostname.slice(1, -1));

      if (address.kind() === "ipv6") {
        return address.toString();
      }
    } catch {
      // Fall through to the common invalid-hostname error.
    }

    throw new TypeError("Invalid hostname");
  }

  if (ipaddr.isValid(hostname)) {
    return ipaddr.parse(hostname).toString();
  }

  if (hostname.includes(":")) {
    throw new TypeError("Invalid hostname");
  }

  try {
    const canonicalHostname = new URL(`http://${hostname}`).hostname
      .toLowerCase()
      .replace(/\.+$/, "");

    if (canonicalHostname.length > 0) {
      return canonicalHostname;
    }
  } catch {
    // Fall through to the common invalid-hostname error.
  }

  throw new TypeError("Invalid hostname");
}
