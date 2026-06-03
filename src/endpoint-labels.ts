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

export function localEndpointChoiceLabel(endpoint: string, index: number) {
  const host = localEndpointHost(endpoint).toLowerCase();
  if (isPrivateIpv4(host)) return index === 0 ? "Best LAN IPv4" : "LAN IPv4";
  if (host.includes(":")) return isUniqueLocalIpv6(host) ? "LAN IPv6" : "IPv6 fallback";
  return "Fallback IPv4";
}
