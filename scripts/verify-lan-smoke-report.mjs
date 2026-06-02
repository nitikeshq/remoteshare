import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const reportPath = process.argv[2];

if (!reportPath) {
  throw new Error("Usage: node scripts/verify-lan-smoke-report.mjs <report.md>");
}

if (!fs.existsSync(reportPath)) {
  throw new Error(`Missing LAN smoke report: ${reportPath}`);
}

const report = fs.readFileSync(reportPath, "utf8");
const tables = parseTables(report);
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const context = requireTable("Test Context");
const autoDiscovery = requireTable("Auto-Discovery Run");
const manualFallback = requireTable("Manual Fallback Run");

const requiredContextFields = [
  "Test date",
  "Tester",
  "RemoteShare version/tag",
  "Input direction",
  "macOS role shown",
  "Windows role shown",
  "macOS model/version",
  "Windows model/version",
  "macOS installer file",
  "macOS installer SHA256",
  "Windows installer file",
  "Windows installer SHA256",
  "Linux installer file",
  "Linux installer SHA256",
  "Router/SSID/band",
  "Same subnet confirmed",
  "macOS firewall status",
  "Windows firewall status",
  "macOS Accessibility permission",
  "macOS Input Monitoring permission"
];

const requiredAutoFields = [
  "macOS IP/subnet",
  "Windows IP/subnet",
  "Peer appeared in `Scan LAN`",
  "Pair action started",
  "Same six-digit code shown on both machines",
  "Six-digit code typed on both machines",
  "`Trusted` shown on both machines",
  "Full fingerprint copied or visually compared",
  "`Auto reconnect` enabled after restart/wake",
  "Startup health shows TCP ready, UDP ready, and start-at-login not failed",
  "`Check` succeeded after restart/wake",
  "Endpoint source shown",
  "`Allow incoming control` enabled on receiver",
  "Per-device `Receive` enabled",
  "Sender `Test` delivered accepted `key press r` input event",
  "Capture started on sender and stopped cleanly",
  "Captured mouse move, mouse click, scroll, and key events accepted on receiver",
  "Failure reason visible before retry",
  "Pass/fail"
];

const requiredManualFields = [
  "Discovery disabled, skipped, or failed",
  "Manual endpoint copied from peer `This computer` row",
  "Endpoint used",
  "TCP `44777` reachable",
  "Pair action started",
  "Same six-digit code shown on both machines",
  "Six-digit code typed on both machines",
  "`Trusted` shown on both machines",
  "Full fingerprint copied or visually compared",
  "`Auto reconnect` enabled after restart/wake",
  "Startup health shows TCP ready, UDP ready, and start-at-login not failed",
  "`Check` succeeded after restart/wake",
  "Endpoint source shown as saved endpoint or manual IP",
  "`Allow incoming control` enabled on receiver",
  "Per-device `Receive` enabled",
  "Sender `Test` delivered accepted `key press r` input event",
  "Capture started on sender and stopped cleanly",
  "Captured mouse move, mouse click, scroll, and key events accepted on receiver",
  "Failure reason visible before retry",
  "Pass/fail"
];

for (const field of requiredContextFields) {
  requireFilled(context, field, "Test Context");
}

for (const field of requiredAutoFields) {
  requireFilled(autoDiscovery, field, "Auto-Discovery Run");
}

for (const field of requiredManualFields) {
  requireFilled(manualFallback, field, "Manual Fallback Run");
}

requireSuccess(context, "Same subnet confirmed", "Test Context");
requireInputDirection(context);
requireMvpRoles(context);
requireSuccess(context, "macOS firewall status", "Test Context");
requireSuccess(context, "Windows firewall status", "Test Context");
requireSuccess(context, "macOS Accessibility permission", "Test Context");
requireSuccess(context, "macOS Input Monitoring permission", "Test Context");
requirePackageVersion(context, "RemoteShare version/tag", "Test Context");
requireInstallerFile(context, "macOS installer file", "Test Context", ".dmg");
requireInstallerFile(context, "Windows installer file", "Test Context", ".exe");
requireInstallerFile(context, "Linux installer file", "Test Context", ".deb");
requireSha256(context, "macOS installer SHA256", "Test Context");
requireSha256(context, "Windows installer SHA256", "Test Context");
requireSha256(context, "Linux installer SHA256", "Test Context");
requirePass(autoDiscovery, "Auto-Discovery Run");
requirePass(manualFallback, "Manual Fallback Run");

const successFields = [
  "Pair action started",
  "Same six-digit code shown on both machines",
  "Six-digit code typed on both machines",
  "`Trusted` shown on both machines",
  "Full fingerprint copied or visually compared",
  "`Auto reconnect` enabled after restart/wake",
  "Startup health shows TCP ready, UDP ready, and start-at-login not failed",
  "`Check` succeeded after restart/wake",
  "`Allow incoming control` enabled on receiver",
  "Per-device `Receive` enabled",
  "Sender `Test` delivered accepted `key press r` input event",
  "Capture started on sender and stopped cleanly",
  "Captured mouse move, mouse click, scroll, and key events accepted on receiver"
];

for (const field of successFields) {
  requireSuccess(autoDiscovery, field, "Auto-Discovery Run");
  requireSuccess(manualFallback, field, "Manual Fallback Run");
}
requireFingerprintEvidence(autoDiscovery, "Auto-Discovery Run");
requireFingerprintEvidence(manualFallback, "Manual Fallback Run");
requireReconnectEvidence(autoDiscovery, "Auto-Discovery Run");
requireReconnectEvidence(manualFallback, "Manual Fallback Run");
requireEndpointSourceEvidence(autoDiscovery, "Endpoint source shown", "Auto-Discovery Run", /discovery|reconnect/);
requireEndpointSourceEvidence(
  manualFallback,
  "Endpoint source shown as saved endpoint or manual IP",
  "Manual Fallback Run",
  /(saved\s+endpoint|manual\s+(ip|endpoint)|set\s+ip|verified\s+endpoint)/
);
requireInputSmokeEvidence(autoDiscovery, "Auto-Discovery Run");
requireInputSmokeEvidence(manualFallback, "Manual Fallback Run");
requireCaptureEvidence(autoDiscovery, "Auto-Discovery Run");
requireCaptureEvidence(manualFallback, "Manual Fallback Run");
requireFailureReasonEvidence(autoDiscovery, "Auto-Discovery Run");
requireFailureReasonEvidence(manualFallback, "Manual Fallback Run");
requireSuccess(autoDiscovery, "Peer appeared in `Scan LAN`", "Auto-Discovery Run");
requireAutoDiscoverySubnetEvidence(autoDiscovery);
requireManualFallbackEvidence(manualFallback);
requireSuccess(manualFallback, "TCP `44777` reachable", "Manual Fallback Run");
requireManualEndpoint(manualFallback, "Endpoint used", "Manual Fallback Run");

console.log(`Verified LAN smoke report: ${path.relative(process.cwd(), reportPath)}`);

function requireTable(name) {
  const table = tables.get(name);
  if (!table) {
    throw new Error(`Missing LAN smoke report section: ${name}`);
  }
  return table;
}

function requireFilled(table, field, section) {
  const value = table.get(field);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ${section} field: ${field}`);
  }
  return value.trim();
}

function requirePass(table, section) {
  const value = requireFilled(table, "Pass/fail", section);
  if (!/^pass(ed)?$/i.test(value)) {
    throw new Error(`${section} must be marked Pass for release readiness.`);
  }
}

function requireSuccess(table, field, section) {
  const value = requireFilled(table, field, section);
  if (!/^(yes|pass|passed|success|succeeded|ok|confirmed|enabled|allowed|delivered|reachable|accepted|compared|shown|started|ready|none|n\/a)/i.test(value)) {
    throw new Error(`${section} field must show success: ${field}`);
  }
}

function requireInputDirection(table) {
  const value = requireFilled(table, "Input direction", "Test Context").toLowerCase();
  if (!/macos.*sender.*main.*windows.*receiver.*client/.test(value)) {
    throw new Error("Test Context Input direction must be macOS sender/main -> Windows receiver/client.");
  }
}

function requireMvpRoles(table) {
  const macRole = requireFilled(table, "macOS role shown", "Test Context").toLowerCase();
  if (!/(^|\W)main(\W|$)/.test(macRole)) {
    throw new Error("Test Context macOS role shown must be Main for the first MVP smoke test.");
  }

  const windowsRole = requireFilled(table, "Windows role shown", "Test Context").toLowerCase();
  if (!/(^|\W)client(\W|$)/.test(windowsRole)) {
    throw new Error("Test Context Windows role shown must be Client for the first MVP smoke test.");
  }
}

function requireFingerprintEvidence(table, section) {
  const value = requireFilled(table, "Full fingerprint copied or visually compared", section).toLowerCase();
  if (
    !/(audit|copy|copied|compare|compared|visual)/.test(value) ||
    !/full/.test(value) ||
    !/(local|mac|macos|sender)/.test(value) ||
    !/(peer|windows|receiver|client)/.test(value)
  ) {
    throw new Error(`${section} fingerprint evidence must mention full local and peer fingerprints copied or compared from the audit view.`);
  }
}

function requireReconnectEvidence(table, section) {
  const autoReconnect = requireFilled(table, "`Auto reconnect` enabled after restart/wake", section).toLowerCase();
  if (!/^(yes|pass|passed|success|succeeded|ok|confirmed|enabled|allowed)/i.test(autoReconnect) || !/(restart|wake)/.test(autoReconnect)) {
    throw new Error(`${section} Auto reconnect evidence must show it stayed enabled after restart or wake.`);
  }

  const startupHealth = requireFilled(
    table,
    "Startup health shows TCP ready, UDP ready, and start-at-login not failed",
    section
  ).toLowerCase();
  if (!/tcp/.test(startupHealth) || !/udp/.test(startupHealth) || !/(start-at-login|startup|start at login)/.test(startupHealth) || /fail|failed|blocked|denied|error/.test(startupHealth)) {
    throw new Error(`${section} startup health evidence must mention TCP ready, UDP ready, and start-at-login not failed.`);
  }

  const check = requireFilled(table, "`Check` succeeded after restart/wake", section).toLowerCase();
  if (!/^(yes|pass|passed|success|succeeded|ok|confirmed|reachable|accepted)/i.test(check) || !/(restart|wake)/.test(check)) {
    throw new Error(`${section} reconnect check evidence must show Check succeeded after restart or wake.`);
  }
}

function requireEndpointSourceEvidence(table, field, section, expectedPattern) {
  const value = requireFilled(table, field, section).toLowerCase();
  if (!expectedPattern.test(value)) {
    throw new Error(`${section} endpoint source evidence must mention the concrete source shown in the UI.`);
  }
}

function requireManualFallbackEvidence(table) {
  const discovery = requireFilled(table, "Discovery disabled, skipped, or failed", "Manual Fallback Run").toLowerCase();
  if (!/(disabled|skipped|failed|blocked|unavailable|not found|not discovered|udp|discovery)/.test(discovery)) {
    throw new Error("Manual Fallback Run discovery evidence must explain that discovery was disabled, skipped, unavailable, or failed.");
  }

  const copied = requireFilled(table, "Manual endpoint copied from peer `This computer` row", "Manual Fallback Run").toLowerCase();
  if (!/(copied|copy)/.test(copied) || !/(peer|other computer|remote|this computer|receiver|windows|client)/.test(copied)) {
    throw new Error("Manual Fallback Run endpoint copy evidence must mention copying the peer computer's `This computer` endpoint.");
  }
}

function requireInputSmokeEvidence(table, section) {
  const value = requireFilled(
    table,
    "Sender `Test` delivered accepted `key press r` input event",
    section
  ).toLowerCase();
  if (!/accepted/.test(value) || !/key\s+press/.test(value) || !/(^|\W)r(\W|$)/.test(value)) {
    throw new Error(`${section} input smoke evidence must mention an accepted key press r event.`);
  }

  const transportContext = requireFilled(
    table,
    "Input Transport source device and relative time shown",
    section
  ).toLowerCase();
  if (
    !/(input transport|source|device|sender|mac|macos|trusted)/.test(transportContext) ||
    !/(time|relative|ago|ms|sec|second|min|minute)/.test(transportContext)
  ) {
    throw new Error(`${section} input transport evidence must mention the source device and relative time shown in the receiver UI.`);
  }
}

function requireCaptureEvidence(table, section) {
  const startStop = requireFilled(
    table,
    "Capture started on sender and stopped cleanly",
    section
  ).toLowerCase();
  if (!/start(ed)?/.test(startStop) || !/stop(ped)?/.test(startStop) || /fail|failed|blocked|denied|error/.test(startStop)) {
    throw new Error(`${section} capture evidence must show capture started and stopped cleanly.`);
  }

  const captureTiming = requireFilled(
    table,
    "Active capture target and elapsed start time shown",
    section
  ).toLowerCase();
  if (
    !/(target|windows|receiver|client|trusted)/.test(captureTiming) ||
    !/(start|started|elapsed|ago|ms|sec|second|min|minute)/.test(captureTiming)
  ) {
    throw new Error(`${section} capture timing evidence must mention the active capture target and elapsed start time shown in the sender UI.`);
  }

  const capturedEvents = requireFilled(
    table,
    "Captured mouse move, mouse click, scroll, and key events accepted on receiver",
    section
  ).toLowerCase();
  if (
    !/accepted/.test(capturedEvents) ||
    !/mouse\s+move/.test(capturedEvents) ||
    !/(mouse\s+click|mouse\s+(down|up)|click)/.test(capturedEvents) ||
    !/scroll/.test(capturedEvents) ||
    !/key/.test(capturedEvents)
  ) {
    throw new Error(`${section} capture evidence must mention accepted mouse move, mouse click, scroll, and key events.`);
  }
}

function requireFailureReasonEvidence(table, section) {
  const value = requireFilled(table, "Failure reason visible before retry", section).toLowerCase();
  if (/^(none|n\/a|no failure|no failures|not applicable)$/.test(value)) {
    return;
  }

  if (
    !/(visible|shown|displayed|ui|diagnostic|message|reason)/.test(value) ||
    !/(failure|failed|error|blocked|denied|stale|endpoint|firewall|permission|retry|recovery|hint)/.test(value)
  ) {
    throw new Error(`${section} failure reason evidence must say none/no failure, or mention the visible UI diagnostic or recovery hint shown before retry.`);
  }
}

function requirePackageVersion(table, field, section) {
  const value = requireFilled(table, field, section);
  if (!value.includes(packageVersion)) {
    throw new Error(
      `${section} field must include package version ${packageVersion}: ${field}`
    );
  }
}

function requireInstallerFile(table, field, section, extension) {
  const value = requireFilled(table, field, section);
  const filename = path.basename(value);
  if (!filename.includes(`_${packageVersion}_`)) {
    throw new Error(
      `${section} installer filename must include package version ${packageVersion}: ${field}`
    );
  }

  if (!filename.toLowerCase().endsWith(extension)) {
    throw new Error(`${section} installer filename must end with ${extension}: ${field}`);
  }
}

function requireSha256(table, field, section) {
  const value = requireFilled(table, field, section);
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${section} field must be a 64-character SHA-256 hex value: ${field}`);
  }
}

function requireManualEndpoint(table, field, section) {
  const value = requireFilled(table, field, section);
  const endpoint = parseEndpoint(value);
  if (!endpoint) {
    throw new Error(`${section} field must be a concrete host:44777 endpoint: ${field}`);
  }

  if (endpoint.port !== 44777) {
    throw new Error(`${section} field must use TCP port 44777: ${field}`);
  }

  if (isLocalOnlyEndpoint(endpoint.host)) {
    throw new Error(`${section} field must use the peer computer endpoint, not localhost or an unspecified bind address: ${field}`);
  }
}

function requireAutoDiscoverySubnetEvidence(table) {
  const mac = parseIpv4Cidr(
    requireFilled(table, "macOS IP/subnet", "Auto-Discovery Run"),
    "macOS IP/subnet"
  );
  const windows = parseIpv4Cidr(
    requireFilled(table, "Windows IP/subnet", "Auto-Discovery Run"),
    "Windows IP/subnet"
  );

  if (isLocalOnlyEndpoint(mac.ip) || isLocalOnlyEndpoint(windows.ip)) {
    throw new Error("Auto-Discovery Run IP/subnet fields must use peer LAN addresses, not localhost or unspecified bind addresses.");
  }

  const prefix = Math.min(mac.prefix, windows.prefix);
  if (networkNumber(mac.ip, prefix) !== networkNumber(windows.ip, prefix)) {
    throw new Error("Auto-Discovery Run macOS IP/subnet and Windows IP/subnet must be on the same IPv4 subnet.");
  }
}

function parseIpv4Cidr(value, field) {
  const match = value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) {
    throw new Error(`Auto-Discovery Run field must use IPv4 CIDR notation like 192.168.1.10/24: ${field}`);
  }

  const ip = match[1];
  const prefix = Number(match[2]);
  if (net.isIP(ip) !== 4 || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) {
    throw new Error(`Auto-Discovery Run field must use a valid IPv4 CIDR value: ${field}`);
  }

  return { ip, prefix };
}

function networkNumber(ip, prefix) {
  const value = ip
    .split(".")
    .map((part) => Number(part))
    .reduce((accumulator, part) => ((accumulator << 8) | part) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0;
}

function parseEndpoint(value) {
  const trimmed = value.trim();
  let host = "";
  let portText = "";

  const ipv6Match = trimmed.match(/^\[([^\]]+)]:(\d+)$/);
  if (ipv6Match) {
    host = ipv6Match[1];
    portText = ipv6Match[2];
  } else {
    const lastColon = trimmed.lastIndexOf(":");
    if (lastColon <= 0 || trimmed.indexOf(":") !== lastColon) return null;
    host = trimmed.slice(0, lastColon);
    portText = trimmed.slice(lastColon + 1);
  }

  const port = Number(portText);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

function isLocalOnlyEndpoint(host) {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "localhost.localdomain" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::1"
  ) {
    return true;
  }

  if (normalized.startsWith("127.")) return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 6 && normalized.startsWith("::ffff:127.")) return true;

  return false;
}

function parseTables(markdown) {
  const parsed = new Map();
  const lines = markdown.split(/\r?\n/);
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }

    if (!section || !lines[index].startsWith("|")) continue;
    const header = cells(lines[index]);
    const separator = lines[index + 1] ? cells(lines[index + 1]) : [];
    if (header.length < 2 || !separator.every((cell) => /^-+$/.test(cell))) continue;

    const rows = new Map();
    index += 2;
    while (index < lines.length && lines[index].startsWith("|")) {
      const row = cells(lines[index]);
      if (row.length >= 2) rows.set(row[0], row[1]);
      index += 1;
    }
    index -= 1;
    parsed.set(section, rows);
  }

  return parsed;
}

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
