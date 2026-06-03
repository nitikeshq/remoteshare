export function localEndpointHost(endpoint: string) {
  const trimmed = endpoint.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end > 1 ? trimmed.slice(1, end) : trimmed;
  }
  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  return firstColon > -1 && firstColon === lastColon ? trimmed.slice(0, firstColon) : trimmed;
}

export function isPrivateIpv4(host: string) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export function isUniqueLocalIpv6(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

export type ManualEndpointValidation =
  | { ok: true; message: string }
  | { ok: false; message: string };

type ParsedManualEndpoint =
  | { ok: true; host: string; port: number | null }
  | { ok: false; message: string };

export function validateManualEndpoint(endpoint: string, privateNetworkOnly: boolean): ManualEndpointValidation {
  const parsed = parseManualEndpoint(endpoint);
  if (!parsed.ok) return parsed;

  const host = parsed.host.toLowerCase();
  if (host === "localhost") {
    return invalidManualEndpoint("Use the other computer's LAN IP or hostname, not localhost.");
  }

  const ipv4 = ipv4Parts(host);
  if (ipv4) {
    if (ipv4[0] === 0 || ipv4[0] === 127) {
      return invalidManualEndpoint("Use a LAN IPv4 address, not loopback or unspecified IPv4.");
    }
    if (ipv4[0] === 169 && ipv4[1] === 254) {
      return invalidManualEndpoint("Avoid link-local IPv4; use the same Wi-Fi/LAN address.");
    }
    if (privateNetworkOnly && !isPrivateIpv4(host)) {
      return invalidManualEndpoint("Private network only is on, so public IPv4 literals are blocked.");
    }
  } else if (host.includes(":")) {
    if (host === "::" || host === "::1") {
      return invalidManualEndpoint("Use a LAN IPv6 address, not loopback or unspecified IPv6.");
    }
    if (host.startsWith("fe80:")) {
      return invalidManualEndpoint("Avoid link-local IPv6 for manual pairing; use LAN IPv4 or unique-local IPv6.");
    }
    if (privateNetworkOnly && !isUniqueLocalIpv6(host)) {
      return invalidManualEndpoint("Private network only is on, so public IPv6 literals are blocked.");
    }
  }

  return { ok: true, message: parsed.port ? `Ready to use port ${parsed.port}.` : "Ready; missing port will use 44777." };
}

export function localEndpointChoiceLabel(endpoint: string, index: number) {
  const host = localEndpointHost(endpoint).toLowerCase();
  if (isPrivateIpv4(host)) return index === 0 ? "Best LAN IPv4" : "LAN IPv4";
  if (host.includes(":")) return isUniqueLocalIpv6(host) ? "LAN IPv6" : "IPv6 fallback";
  return "Fallback IPv4";
}

export function localEndpointManualFallbackLabel(endpoint: string, index: number) {
  const choice = localEndpointChoiceLabel(endpoint, index);
  if (choice === "Best LAN IPv4") return "preferred LAN IPv4";
  if (choice === "LAN IPv4") return "LAN IPv4";
  if (choice === "LAN IPv6") return "LAN IPv6";
  return "not first-MVP preferred";
}

function parseManualEndpoint(endpoint: string): ParsedManualEndpoint {
  const trimmed = endpoint.trim();
  if (!trimmed) return invalidManualEndpoint("Paste an endpoint from the other computer.");
  if (/\s/.test(trimmed)) return invalidManualEndpoint("Endpoint cannot contain spaces.");
  if (trimmed.includes("://") || /[/\\]/.test(trimmed)) {
    return invalidManualEndpoint("Paste only host or host:port, not a URL.");
  }

  if (trimmed.startsWith("[")) {
    const bracketEnd = trimmed.indexOf("]");
    if (bracketEnd <= 1) return invalidManualEndpoint("Bracketed IPv6 endpoint is incomplete.");
    const host = trimmed.slice(1, bracketEnd);
    const suffix = trimmed.slice(bracketEnd + 1);
    if (!host.includes(":")) return invalidManualEndpoint("Brackets are only needed for IPv6 addresses.");
    if (!suffix) return { ok: true, host, port: null };
    if (!suffix.startsWith(":")) return invalidManualEndpoint("Use [IPv6]:port for bracketed IPv6 endpoints.");
    const port = validPort(suffix.slice(1));
    if (!port) return invalidManualEndpoint("Port must be a number from 1 to 65535.");
    return { ok: true, host, port };
  }

  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon > -1 && firstColon !== lastColon) {
    return { ok: true, host: trimmed, port: null };
  }

  if (firstColon > -1) {
    const host = trimmed.slice(0, firstColon);
    const port = validPort(trimmed.slice(firstColon + 1));
    if (!host) return invalidManualEndpoint("Host is missing before the port.");
    if (!port) return invalidManualEndpoint("Port must be a number from 1 to 65535.");
    return { ok: true, host, port };
  }

  return { ok: true, host: trimmed, port: null };
}

function validPort(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function ipv4Parts(host: string) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function invalidManualEndpoint(message: string): { ok: false; message: string } {
  return { ok: false, message };
}
