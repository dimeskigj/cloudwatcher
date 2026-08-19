import type { CompiledCidr } from "./cidr";
import { matchIp } from "./cidr";
import type { DetectionEvidence, DetectionMatch } from "./model";

type HeaderSignal = Extract<DetectionEvidence, { kind: "header" }>["signal"];

interface ResponseHeader {
  name: string;
  value?: string;
}

interface DetectionInput {
  responseHeaders?: readonly ResponseHeader[];
  ip?: string;
  ranges: readonly CompiledCidr[];
}

const STRONG_HEADER_SIGNALS = new Map<string, HeaderSignal>([
  ["cf-ray", "cf-ray"],
  ["cf-cache-status", "cf-cache-status"],
  ["cf-mitigated", "cf-mitigated"],
]);

export function detectCloudflare({
  responseHeaders = [],
  ip,
  ranges,
}: DetectionInput): DetectionMatch | null {
  const normalizedHeaders = responseHeaders.map(({ name, value }) => ({
    name: name.trim().toLowerCase(),
    value: value?.trim().toLowerCase(),
  }));
  const headerSignals = new Set<HeaderSignal>();
  const evidence: DetectionEvidence[] = [];

  for (const header of normalizedHeaders) {
    const signal =
      STRONG_HEADER_SIGNALS.get(header.name) ??
      (header.name === "server" &&
      (header.value === "cloudflare" || header.value === "cloudflare-nginx")
        ? "server: cloudflare"
        : undefined);

    if (signal !== undefined && !headerSignals.has(signal)) {
      headerSignals.add(signal);
      evidence.push({ kind: "header", signal });
    }
  }

  if (ip !== undefined) {
    const range = matchIp(ip, ranges);

    if (range !== undefined) {
      evidence.push({ kind: "ip", ip, cidr: range.text });
    }
  }

  return evidence.length === 0 ? null : { evidence };
}
