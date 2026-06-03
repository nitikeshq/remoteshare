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
  "Pairing evidence copied from pending row",
  "`Trusted` shown on both machines",
  "Full fingerprint copied or visually compared",
  "`Auto reconnect` enabled after restart/wake",
  "Startup health shows TCP ready, UDP ready, and start-at-login not failed",
  "`Check` succeeded after restart/wake",
  "Endpoint source shown",
  "`Allow incoming control` enabled on receiver",
  "Per-device `Receive` enabled",
  "Sender `Test` delivered accepted `key press r` input event",
  "Input Transport source device and relative time shown",
  "Capture started on sender and stopped cleanly",
  "Active capture target and elapsed start time shown",
  "Captured mouse move, mouse click, scroll, and key events accepted on receiver",
  "Failure reason visible before retry",
  "Pass/fail"
];

const requiredManualFields = [
  "Discovery disabled, skipped, or failed",
  "Manual endpoint copied from peer `This computer` row",
  "Copied endpoint label shown",
  "Endpoint used",
  "TCP `44777` reachable",
  "Pair action started",
  "Same six-digit code shown on both machines",
  "Six-digit code typed on both machines",
  "Pairing evidence copied from pending row",
  "`Trusted` shown on both machines",
  "Full fingerprint copied or visually compared",
  "`Auto reconnect` enabled after restart/wake",
  "Startup health shows TCP ready, UDP ready, and start-at-login not failed",
  "`Check` succeeded after restart/wake",
  "Endpoint source shown as saved endpoint or manual IP",
  "`Allow incoming control` enabled on receiver",
  "Per-device `Receive` enabled",
  "Sender `Test` delivered accepted `key press r` input event",
  "Input Transport source device and relative time shown",
  "Capture started on sender and stopped cleanly",
  "Active capture target and elapsed start time shown",
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
requireIsoDate(context, "Test date", "Test Context");
requireInputDirection(context);
requireMvpRoles(context);
requireMachineContext(context, "macOS model/version", /\bmac(os)?\b/, /\b(macbook|mac\s+mini|imac|mac\s+studio|mac\s+pro|apple\s+silicon|m[1-9]\b)/);
requireMachineContext(context, "Windows model/version", /\bwindows\b/, /\b(pc|desktop|laptop|workstation|surface|thinkpad|latitude|inspiron|xps|elitebook|probook|pavilion|legion|ideapad|zenbook|vivobook|rog|tuf|predator|aspire|swift|envy|spectre|omen|nuc|mini\s+pc)\b/);
requireFirewallPortEvidence(context, "macOS firewall status");
requireFirewallPortEvidence(context, "Windows firewall status");
requireMacInputPermissionEvidence(context, "macOS Accessibility permission");
requireMacInputPermissionEvidence(context, "macOS Input Monitoring permission");
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
  "Capture started on sender and stopped cleanly"
];

for (const field of successFields) {
  requireSuccess(autoDiscovery, field, "Auto-Discovery Run");
  requireSuccess(manualFallback, field, "Manual Fallback Run");
}
requireFingerprintEvidence(autoDiscovery, "Auto-Discovery Run");
requireFingerprintEvidence(manualFallback, "Manual Fallback Run");
requirePairingEvidence(autoDiscovery, "Auto-Discovery Run");
requirePairingEvidence(manualFallback, "Manual Fallback Run");
requirePairingFlowEvidence(autoDiscovery, "Auto-Discovery Run");
requirePairingFlowEvidence(manualFallback, "Manual Fallback Run");
requireTrustedShownEvidence(autoDiscovery, "Auto-Discovery Run");
requireTrustedShownEvidence(manualFallback, "Manual Fallback Run");
requireReconnectEvidence(autoDiscovery, "Auto-Discovery Run");
requireReconnectEvidence(manualFallback, "Manual Fallback Run");
requireEndpointSourceEvidence(
  autoDiscovery,
  "Endpoint source shown",
  "Auto-Discovery Run",
  /\b(discovery|reconnect|saved\s+endpoint)\b/
);
requireEndpointSourceEvidence(
  manualFallback,
  "Endpoint source shown as saved endpoint or manual IP",
  "Manual Fallback Run",
  /\b(saved\s+endpoint|manual\s+(ip|endpoint)|set\s+ip|verified\s+endpoint)\b/
);
requireReceiveControlEvidence(autoDiscovery, "Auto-Discovery Run");
requireReceiveControlEvidence(manualFallback, "Manual Fallback Run");
requireInputSmokeEvidence(autoDiscovery, "Auto-Discovery Run");
requireInputSmokeEvidence(manualFallback, "Manual Fallback Run");
requireCaptureEvidence(autoDiscovery, "Auto-Discovery Run");
requireCaptureEvidence(manualFallback, "Manual Fallback Run");
requireFailureReasonEvidence(autoDiscovery, "Auto-Discovery Run");
requireFailureReasonEvidence(manualFallback, "Manual Fallback Run");
requireManualFailureReasonEvidence(manualFallback);
requireSuccess(autoDiscovery, "Peer appeared in `Scan LAN`", "Auto-Discovery Run");
requireAutoDiscoverySubnetEvidence(autoDiscovery);
requireManualFallbackEvidence(manualFallback);
requireManualEndpointLabelEvidence(manualFallback);
requireManualTcpReachabilityEvidence(manualFallback);
requireManualEndpoint(manualFallback, "Endpoint used", "Manual Fallback Run");
requireManualEndpointMatchesCopiedEvidence(manualFallback);
requireNoBlockingNotes(report);

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
  const valueWithoutExpectedNegative = value
    .replace(/\bnot\s+failed\b/ig, "")
    .replace(/\bnot\s+failing\b/ig, "");
  if (
    !/^(yes|pass|passed|success|succeeded|ok|confirmed|enabled|allowed|delivered|reachable|accepted|compared|shown|started|ready)/i.test(value) ||
    /(fail|failed|failure|blocked|denied|error|not\s+(ok|ready|accepted|enabled|allowed|reachable|shown|started|delivered|confirmed|compared))/i.test(valueWithoutExpectedNegative)
  ) {
    throw new Error(`${section} field must show success: ${field}`);
  }
}

function requireIsoDate(table, field, section) {
  const value = requireFilled(table, field, section);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${section} ${field} must be an ISO date in YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${section} ${field} must be a valid calendar date.`);
  }

  const today = todayIsoDate();
  if (value > today) {
    throw new Error(`${section} ${field} cannot be in the future: got ${value}, today is ${today}.`);
  }
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function requireInputDirection(table) {
  const value = requireFilled(table, "Input direction", "Test Context").toLowerCase();
  if (!isSetupEvidence(value) || !/input\s+direction:\s*macos\s+sender\/main\s+->\s+windows\s+receiver\/client/.test(value)) {
    throw new Error("Test Context Input direction must paste setup checklist Copy output with macOS sender/main -> Windows receiver/client.");
  }
}

function requireMvpRoles(table) {
  const macRole = requireFilled(table, "macOS role shown", "Test Context").toLowerCase();
  if (!isSetupEvidence(macRole) || !/platform:\s*macos/.test(macRole) || !/role:\s*main/.test(macRole)) {
    throw new Error("Test Context macOS role shown must paste setup checklist Copy output with Platform: macos and Role: Main.");
  }

  const windowsRole = requireFilled(table, "Windows role shown", "Test Context").toLowerCase();
  if (!isSetupEvidence(windowsRole) || !/platform:\s*windows/.test(windowsRole) || !/role:\s*client/.test(windowsRole)) {
    throw new Error("Test Context Windows role shown must paste setup checklist Copy output with Platform: windows and Role: Client.");
  }
}

function requireMacInputPermissionEvidence(table, field) {
  const value = requireFilled(table, field, "Test Context").toLowerCase();
  if (
    !isSetupEvidence(value) ||
    !/platform:\s*macos/.test(value) ||
    !/role:\s*main/.test(value) ||
    !/mac\s+input\s+permissions:\s*done/.test(value) ||
    !/accessibility/.test(value) ||
    !/input\s+monitoring/.test(value)
  ) {
    throw new Error(`Test Context ${field} must paste the Mac sender setup checklist Copy output with Mac input permissions: done for Accessibility and Input Monitoring.`);
  }
}

function requireFirewallPortEvidence(table, field) {
  const value = requireFilled(table, field, "Test Context");
  requireSuccess(table, field, "Test Context");
  const normalized = value.toLowerCase();
  if (!/\btcp\b/.test(normalized) || !/(^|\D)44777(\D|$)/.test(normalized) || !/\budp\b/.test(normalized) || !/(^|\D)44778(\D|$)/.test(normalized)) {
    throw new Error(`Test Context ${field} must mention allowed firewall rules for TCP 44777 and UDP 44778.`);
  }
}

function requireMachineContext(table, field, osPattern, hardwarePattern) {
  const value = requireFilled(table, field, "Test Context").toLowerCase();
  if (!osPattern.test(value) || !hardwarePattern.test(value) || value.length < 10) {
    throw new Error(`Test Context ${field} must name the OS version and the physical computer model or hardware class.`);
  }
}

function isSetupEvidence(value) {
  return (
    /(^|[;|]\s*)setup\b/.test(value) &&
    /this\s+computer:\s*[^;|]+/.test(value) &&
    /platform:\s*[^;|]+/.test(value) &&
    /role:\s*[^;|]+/.test(value) &&
    /choose\s+roles:\s*(done|pending)/.test(value)
  );
}

function requireFingerprintEvidence(table, section) {
  const value = requireFilled(table, "Full fingerprint copied or visually compared", section).toLowerCase();
  if (!isFingerprintAuditEvidence(value)) {
    throw new Error(`${section} fingerprint evidence must paste the Trusted Device Audit evidence output with this computer, local fingerprint, peer, and peer fingerprint.`);
  }
}

function isFingerprintAuditEvidence(value) {
  if (
    !/trusted\s+device\s+audit/.test(value) ||
    !/this\s+computer:\s*[^;|]+/.test(value) ||
    !/local\s+fingerprint:\s*(?!unavailable\b)[a-f0-9][a-f0-9:\-\s]{15,}/.test(value) ||
    !/peer:\s*[^;|]+/.test(value) ||
    !/peer\s+fingerprint:\s*(?!unavailable\b)[a-f0-9][a-f0-9:\-\s]{15,}/.test(value)
  ) {
    return false;
  }
  return true;
}

function requirePairingEvidence(table, section) {
  const value = requireFilled(table, "Pairing evidence copied from pending row", section).toLowerCase();
  if (!isPairingCopyEvidence(value)) {
    throw new Error(`${section} pairing evidence must paste the pending-row copy output with direction, this computer, visible code, typed-code state, local/remote approval, and expiry.`);
  }
}

function requirePairingFlowEvidence(table, section) {
  const pairAction = requireFilled(table, "Pair action started", section).toLowerCase();
  if (!isPairingCopyEvidence(pairAction)) {
    throw new Error(`${section} pair action evidence must paste the pending-row copy output after Pair is started.`);
  }

  const codeShown = requireFilled(table, "Same six-digit code shown on both machines", section).toLowerCase();
  if (!isPairingCopyEvidence(codeShown) || !/visible\s+code:\s*\d{6}/.test(codeShown)) {
    throw new Error(`${section} visible code evidence must paste the pending-row copy output with the six-digit visible code.`);
  }

  const codeTyped = requireFilled(table, "Six-digit code typed on both machines", section).toLowerCase();
  if (!isPairingCopyEvidence(codeTyped) || !/typed\s+code\s+state:\s*codes\s+match/.test(codeTyped)) {
    throw new Error(`${section} typed-code evidence must paste the pending-row copy output with Typed code state: Codes match.`);
  }
}

function isPairingCopyEvidence(value) {
  if (
    !/pairing:\s*(incoming|outgoing)/.test(value) ||
    !/this\s+computer:\s*[^;|]+/.test(value) ||
    !/visible\s+code:\s*\d{6}/.test(value) ||
    !/typed\s+code\s+state:\s*(codes\s+match|expired|code\s+mismatch|\d+\s+digits?\s+left|type\s+other\s+code)/.test(value) ||
    !/local:\s*(approved|pending)/.test(value) ||
    !/remote:\s*(approved|pending)/.test(value) ||
    !/expires:/.test(value)
  ) {
    return false;
  }
  return true;
}

function requireTrustedShownEvidence(table, section) {
  const value = requireFilled(table, "`Trusted` shown on both machines", section).toLowerCase();
  if (!isFingerprintAuditEvidence(value)) {
    throw new Error(`${section} trusted evidence must paste the Trusted Device Audit evidence output after trust is shown on both machines.`);
  }
}

function requireReconnectEvidence(table, section) {
  const autoReconnect = requireFilled(table, "`Auto reconnect` enabled after restart/wake", section).toLowerCase();
  if (
    !/trusted\s+reconnect/.test(autoReconnect) ||
    !/this\s+computer:\s*[^;|]+/.test(autoReconnect) ||
    !/auto\s+reconnect:\s*enabled/.test(autoReconnect) ||
    !/device:\s*[^;|]+/.test(autoReconnect) ||
    !/check:\s*reachable/.test(autoReconnect) ||
    !/last\s+seen:/.test(autoReconnect) ||
    !/latency:\s*[0-9]+(\.[0-9]+)?\s*ms/.test(autoReconnect) ||
    !/endpoint\s+source:\s*/.test(autoReconnect) ||
    !/endpoint:\s*[^;|]+/.test(autoReconnect) ||
    !/verification:\s*after\s+restart\/wake/.test(autoReconnect)
  ) {
    throw new Error(`${section} Auto reconnect evidence must paste the full reconnect Copy output with Auto reconnect: enabled, Check: reachable, Verification: after restart/wake, measured Latency, endpoint source, and endpoint.`);
  }

  const startupHealth = requireFilled(
    table,
    "Startup health shows TCP ready, UDP ready, and start-at-login not failed",
    section
  ).toLowerCase();
  const startupHealthWithoutExpectedNegative = startupHealth
    .replace(/\bnot\s+failed\b/g, "")
    .replace(/\bnot\s+failing\b/g, "");
  if (
    !/startup\s+health/.test(startupHealth) ||
    !/this\s+computer:\s*[^;|]+/.test(startupHealth) ||
    !/tcp:\s*[^;]*(ready|listening|bound)/.test(startupHealth) ||
    !/udp:\s*[^;]*(ready|listening|bound)/.test(startupHealth) ||
    !/start:\s*[^;]*(start-at-login|startup|start at login)/.test(startupHealth) ||
    !/(started|reconnect):\s*/.test(startupHealth) ||
    /fail|failed|blocked|denied|error/.test(startupHealthWithoutExpectedNegative)
  ) {
    throw new Error(`${section} startup health evidence must paste the startup health Copy output with Startup health, This computer, TCP, UDP, Start, and Started/Reconnect fields, and show start-at-login is not failed.`);
  }

  const check = requireFilled(table, "`Check` succeeded after restart/wake", section).toLowerCase();
  if (
    !/trusted\s+reconnect/.test(check) ||
    !/check:\s*reachable/.test(check) ||
    !/device:\s*[^;|]+/.test(check) ||
    !/last\s+seen:/.test(check) ||
    !/latency:\s*[0-9]+(\.[0-9]+)?\s*ms/.test(check) ||
    !/verification:\s*after\s+restart\/wake/.test(check)
  ) {
    throw new Error(`${section} reconnect check evidence must paste the reconnect Copy output with Check: reachable, Verification: after restart/wake, and measured Latency.`);
  }
}

function requireEndpointSourceEvidence(table, field, section, expectedPattern) {
  const value = requireFilled(table, field, section).toLowerCase();
  const valueWithoutExpectedNegative = value
    .replace(/\blast\s+failure:\s*(none|no\s+failure)\b/g, "")
    .replace(/\brecovery:\s*none\b/g, "");
  if (
    !/trusted\s+reconnect/.test(value) ||
    !/endpoint\s+source:\s*/.test(value) ||
    !/endpoint:\s*[^;|]+/.test(value) ||
    !/latency:\s*[0-9]+(\.[0-9]+)?\s*ms/.test(value) ||
    /(fail|failed|failure|blocked|denied|error|not\s+(shown|discovery|reconnect|saved|manual|verified|set|currently\s+reachable))/.test(valueWithoutExpectedNegative) ||
    !expectedPattern.test(value)
  ) {
    throw new Error(`${section} endpoint source evidence must paste the reconnect Copy output with measured Latency and the concrete endpoint source shown in the UI.`);
  }
}

function requireManualFallbackEvidence(table) {
  const discovery = requireFilled(table, "Discovery disabled, skipped, or failed", "Manual Fallback Run").toLowerCase();
  const discoveryFallbackFailurePattern =
    /(disabled|skipped|failed|blocked|unavailable|not\s+found|not\s+discovered|udp\s+(blocked|failed|unavailable)|discovery\s+(disabled|skipped|failed|blocked|unavailable))/;
  const discoverySuccessPattern = /\b(works|worked|succeeded|success|successful|enabled|shown|available)\b/;
  if (!discoveryFallbackFailurePattern.test(discovery) || discoverySuccessPattern.test(discovery)) {
    throw new Error("Manual Fallback Run discovery evidence must explain that discovery was disabled, skipped, unavailable, or failed.");
  }

  const copied = requireFilled(table, "Manual endpoint copied from peer `This computer` row", "Manual Fallback Run").toLowerCase();
  if (!isLocalEndpointCopyEvidence(copied) || !/(receiver|windows|client)/.test(copied)) {
    throw new Error("Manual Fallback Run endpoint copy evidence must paste the peer computer's local endpoint Evidence output from the `This computer` row.");
  }
}

function requireManualEndpointLabelEvidence(table) {
  const value = requireFilled(table, "Copied endpoint label shown", "Manual Fallback Run").toLowerCase();
  if (!isLocalEndpointCopyEvidence(value) || !/\blabel:\s*(best\s+lan\s+ipv4|lan\s+ipv4|lan\s+ipv6)\b/.test(value)) {
    throw new Error("Manual Fallback Run copied endpoint label evidence must paste local endpoint Evidence output with Label: Best LAN IPv4, LAN IPv4, or LAN IPv6.");
  }
}

function requireManualEndpointMatchesCopiedEvidence(table) {
  const copiedEndpoint = endpointFromLocalEndpointEvidence(
    requireFilled(table, "Manual endpoint copied from peer `This computer` row", "Manual Fallback Run")
  );
  const labelEndpoint = endpointFromLocalEndpointEvidence(
    requireFilled(table, "Copied endpoint label shown", "Manual Fallback Run")
  );
  const manualEndpoint = requireFilled(table, "Endpoint used", "Manual Fallback Run");

  if (
    !copiedEndpoint ||
    !labelEndpoint ||
    endpointKey(copiedEndpoint) !== endpointKey(labelEndpoint) ||
    endpointKey(copiedEndpoint) !== endpointKey(manualEndpoint)
  ) {
    throw new Error("Manual Fallback Run Endpoint used must match the endpoint pasted from the peer computer's local endpoint Evidence output.");
  }
}

function isLocalEndpointCopyEvidence(value) {
  return (
    /local\s+endpoint/.test(value) &&
    /this\s+computer:\s*[^;|]+/.test(value) &&
    /\blabel:\s*[^;|]+/.test(value) &&
    /\bendpoint:\s*[^;|]+/.test(value) &&
    /\btcp\s+port:\s*44777\b/.test(value)
  );
}

function endpointFromLocalEndpointEvidence(value) {
  return value.match(/\bendpoint:\s*([^;|]+)/i)?.[1]?.trim() ?? null;
}

function endpointKey(value) {
  const endpoint = parseEndpoint(value);
  if (!endpoint) return null;
  return `${endpoint.host.trim().toLowerCase()}:${endpoint.port}`;
}

function requireManualTcpReachabilityEvidence(table) {
  const value = requireFilled(table, "TCP `44777` reachable", "Manual Fallback Run").toLowerCase();
  const valueWithoutExpectedNegative = value
    .replace(/\bnot\s+failed\b/g, "")
    .replace(/\bnot\s+failing\b/g, "");
  if (
    !/^(yes|pass|passed|success|succeeded|ok|confirmed|reachable)/i.test(value) ||
    /(fail|failed|failure|blocked|denied|error|not\s+(ok|reachable|open|succeeded|successful))/.test(valueWithoutExpectedNegative) ||
    !/\btcp\b/.test(value) ||
    !/(^|\D)44777(\D|$)/.test(value) ||
    !/(test-netconnection|tnc|nc\s+-|netcat|telnet|socket|port|probe|connect)/.test(value)
  ) {
    throw new Error("Manual Fallback Run TCP reachability evidence must mention a successful TCP 44777 probe, such as Test-NetConnection, nc/netcat, telnet, socket connect, or port probe.");
  }
}

function requireInputSmokeEvidence(table, section) {
  const value = requireFilled(
    table,
    "Sender `Test` delivered accepted `key press r` input event",
    section
  ).toLowerCase();
  if (
    !/input\s+transport:\s*outgoing/.test(value) ||
    !/this\s+computer:\s*[^;|]+/.test(value) ||
    !/summary:\s*[^;|]*key\s+press\s+r/.test(value) ||
    !/device:\s*[^;|]+/.test(value) ||
    !/time:\s*(now|less than|[0-9]+(\.[0-9]+)?\s*(ms|s|sec|second|min|minute|hour|ago))/.test(value) ||
    !/status:\s*accepted/.test(value)
  ) {
    throw new Error(`${section} input smoke evidence must paste the sender Input Transport Copy output with Input Transport: outgoing, This computer, Summary: key press r, Device, Time, and Status: accepted fields.`);
  }

  const transportContext = requireFilled(
    table,
    "Input Transport source device and relative time shown",
    section
  ).toLowerCase();
  if (
    !/input\s+transport:\s*incoming/.test(transportContext) ||
    !/this\s+computer:\s*[^;|]+/.test(transportContext) ||
    !/summary:\s*[^;|]*key\s+press\s+r/.test(transportContext) ||
    !/device:\s*[^;|]+/.test(transportContext) ||
    !/time:\s*(now|less than|[0-9]+(\.[0-9]+)?\s*(ms|s|sec|second|min|minute|hour|ago))/.test(transportContext) ||
    !/status:\s*accepted/.test(transportContext)
  ) {
    throw new Error(`${section} input transport evidence must paste the receiver Input Transport Copy output with Input Transport: incoming, This computer, Summary: key press r, Device, Time, and Status: accepted fields.`);
  }
}

function requireReceiveControlEvidence(table, section) {
  const globalReceive = requireFilled(table, "`Allow incoming control` enabled on receiver", section).toLowerCase();
  if (
    !/receive\s+control/.test(globalReceive) ||
    !/allow\s+incoming\s+control:\s*enabled/.test(globalReceive)
  ) {
    throw new Error(`${section} Allow incoming control evidence must paste the receive Copy output with Allow incoming control: enabled.`);
  }

  const deviceReceive = requireFilled(table, "Per-device `Receive` enabled", section).toLowerCase();
  if (
    !/receive\s+control/.test(deviceReceive) ||
    !/device:\s*[^;|]+/.test(deviceReceive) ||
    !/device\s+receive:\s*enabled/.test(deviceReceive) ||
    !/input\s+control:\s*ready/.test(deviceReceive)
  ) {
    throw new Error(`${section} per-device Receive evidence must paste the receive Copy output with device, Device receive: enabled, and Input control: ready.`);
  }
}

function requireCaptureEvidence(table, section) {
  const startStop = requireFilled(
    table,
    "Capture started on sender and stopped cleanly",
    section
  ).toLowerCase();
  const startStopWithoutExpectedNegative = startStop
    .replace(/\bstopped\s+cleanly\b/g, "")
    .replace(/\bnot\s+failed\b/g, "");
  if (
    !/capture:\s*stopped/.test(startStop) ||
    !/this\s+computer:\s*[^;|]+/.test(startStop) ||
    !/target:\s*(windows|receiver|client|trusted|[^\s|;]+)/.test(startStop) ||
    !/started:\s*(now|less than|[0-9]+(\.[0-9]+)?\s*(ms|s|sec|second|min|minute|hour|ago))/.test(startStop) ||
    !/stopped:\s*(now|less than|[0-9]+(\.[0-9]+)?\s*(ms|s|sec|second|min|minute|hour|ago))/.test(startStop) ||
    !/result:\s*stopped\s+cleanly/.test(startStop) ||
    /fail|failed|blocked|denied|error/.test(startStopWithoutExpectedNegative)
  ) {
    throw new Error(`${section} capture start/stop evidence must paste the stopped capture Copy output with Capture: stopped, This computer, Target, Started, Stopped, and Result: stopped cleanly fields.`);
  }

  const captureTiming = requireFilled(
    table,
    "Active capture target and elapsed start time shown",
    section
  ).toLowerCase();
  if (
    !/capture:\s*active/.test(captureTiming) ||
    !/this\s+computer:\s*[^;|]+/.test(captureTiming) ||
    !/target:\s*(windows|receiver|client|trusted|[^\s|;]+)/.test(captureTiming) ||
    !/started:\s*(now|less than|[0-9]+(\.[0-9]+)?\s*(ms|s|sec|second|min|minute|hour|ago))/.test(captureTiming)
  ) {
    throw new Error(`${section} capture timing evidence must paste the capture Copy output with Capture: active, This computer, Target, and Started fields from the sender UI before pressing Stop.`);
  }

  const capturedEvents = requireFilled(
    table,
    "Captured mouse move, mouse click, scroll, and key events accepted on receiver",
    section
  ).toLowerCase();
  const incomingCopies = capturedEvents.match(/input\s+transport:\s*incoming/g) ?? [];
  const acceptedStatuses = capturedEvents.match(/status:\s*accepted/g) ?? [];
  if (
    incomingCopies.length < 4 ||
    acceptedStatuses.length < 4 ||
    !/this\s+computer:\s*[^;|]+/.test(capturedEvents) ||
    !/device:\s*[^;|]+/.test(capturedEvents) ||
    !/time:\s*(now|less than|[0-9]+(\.[0-9]+)?\s*(ms|s|sec|second|min|minute|hour|ago))/.test(capturedEvents) ||
    !/mouse\s+move/.test(capturedEvents) ||
    !/(mouse\s+click|mouse\s+(down|up)|click)/.test(capturedEvents) ||
    !/scroll/.test(capturedEvents) ||
    !/key/.test(capturedEvents)
  ) {
    throw new Error(`${section} capture event evidence must paste receiver Input Transport Copy output for accepted mouse move, mouse click, scroll, and key events.`);
  }
}

function requireFailureReasonEvidence(table, section) {
  const value = requireFilled(table, "Failure reason visible before retry", section).toLowerCase();
  if (isNoFailureEvidence(value)) {
    return;
  }

  if (
    !/(visible|shown|displayed|ui|diagnostic|message|reason)/.test(value) ||
    !/(failure|failed|error|blocked|denied|stale|endpoint|firewall|permission|retry|recovery|hint)/.test(value)
  ) {
    throw new Error(`${section} failure reason evidence must say none/no failure, or mention the visible UI diagnostic or recovery hint shown before retry.`);
  }
}

function requireManualFailureReasonEvidence(table) {
  const value = requireFilled(table, "Failure reason visible before retry", "Manual Fallback Run").toLowerCase();
  if (isNoFailureEvidence(value)) return;

  if (
    !/(manual\s+(ip|endpoint)|set\s+ip|verify\s+ip|copied\s+endpoint|port\s+44777|tcp\s+44777|firewall)/.test(value)
  ) {
    throw new Error("Manual Fallback Run failure reason evidence must mention the manual IP, Set IP / Verify IP, copied endpoint, TCP 44777, or firewall recovery path.");
  }

  requireTrustedIpUpdateCopyEvidence(value);
}

function requireTrustedIpUpdateCopyEvidence(value) {
  if (
    !/trusted\s+ip\s+update/.test(value) ||
    !/this\s+computer:\s*[^;|]+/.test(value) ||
    !/device:\s*[^;|]+/.test(value) ||
    !/action:\s*(verify\s+ip\s+without\s+re-pairing|pair\s+manually\s+with\s+copied\s+endpoint)/.test(value) ||
    !/endpoint\s+field:\s*[^;|]+/.test(value) ||
    !/copied\s+endpoint:\s*[^;|]+/.test(value) ||
    !/tcp\s+port:\s*44777\b/.test(value) ||
    !/current\s+endpoint:\s*[^;|]+/.test(value) ||
    !/current\s+source:\s*[^;|]+/.test(value) ||
    !/last\s+failure:\s*[^;|]+/.test(value) ||
    !/recovery:\s*[^;|]+/.test(value)
  ) {
    throw new Error("Manual Fallback Run retry evidence must paste the trusted IP update Copy output with this computer, device, recovery action, endpoint field, copied endpoint, TCP port, current endpoint/source, last failure, and recovery hint.");
  }
}

function isNoFailureEvidence(value) {
  return /^(none|n\/a|not applicable)(\s+(before\s+retry|observed|needed|shown|visible))?$/.test(value) ||
    /^no\s+failures?(\s+(before\s+retry|observed|needed|shown|visible|during\s+run))?$/.test(value);
}

function requirePackageVersion(table, field, section) {
  const value = requireFilled(table, field, section);
  if (!packageVersionTokenPattern(packageVersion).test(value)) {
    throw new Error(
      `${section} field must include exact package version ${packageVersion}: ${field}`
    );
  }
}

function packageVersionTokenPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z.])v?${escaped}([^0-9A-Za-z.+-]|$)`);
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

  if (net.isIP(endpoint.host.trim().toLowerCase()) === 0) {
    throw new Error(`${section} field must use a private IPv4 or unique-local IPv6 endpoint literal copied from the peer computer: ${field}`);
  }

  if (isPublicIpLiteral(endpoint.host)) {
    throw new Error(`${section} field must not use a public IP literal while Private network only is enabled: ${field}`);
  }

  if (isLinkLocalIpv6Literal(endpoint.host)) {
    throw new Error(`${section} field must not use a link-local IPv6 literal; copy a private IPv4 or unique-local IPv6 endpoint from the peer computer: ${field}`);
  }
}

function requireNoBlockingNotes(markdown) {
  const notes = parseNotes(markdown);
  const blockingIssues = notes.get("blocking issues");
  if (!blockingIssues) {
    throw new Error("LAN smoke report Notes must include `Blocking issues: none` for release readiness.");
  }
  if (!isNoneNote(blockingIssues)) {
    throw new Error("LAN smoke report Notes must not list unresolved blocking issues for release readiness.");
  }

  const retestRequired = notes.get("retest required");
  if (!retestRequired) {
    throw new Error("LAN smoke report Notes must include `Retest required: no` for release readiness.");
  }
  if (!isNoneNote(retestRequired)) {
    throw new Error("LAN smoke report Notes must not require retest for release readiness.");
  }

  const capturedEvidence = notes.get("screenshots or logs captured");
  if (!capturedEvidence || isNoneNote(capturedEvidence)) {
    throw new Error("LAN smoke report Notes must identify screenshots or logs captured for release evidence.");
  }
  requireCapturedEvidenceNotes(capturedEvidence);
}

function requireCapturedEvidenceNotes(value) {
  const normalized = value.toLowerCase();
  const missingEvidence = [];
  if (!/pair(ing)?/.test(normalized)) missingEvidence.push("pairing");
  if (!/reconnect/.test(normalized)) missingEvidence.push("reconnect");
  if (!/input/.test(normalized)) missingEvidence.push("input");
  if (!/capture|captured/.test(normalized)) missingEvidence.push("capture");

  if (missingEvidence.length > 0) {
    throw new Error(
      `LAN smoke report Notes screenshots or logs captured must identify pairing, reconnect, input, and capture evidence; missing ${missingEvidence.join(", ")}.`
    );
  }
}

function parseNotes(markdown) {
  const notes = new Map();
  const lines = markdown.split(/\r?\n/);
  let inNotes = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      inNotes = heading[1].trim() === "Notes";
      continue;
    }

    if (!inNotes) continue;

    const note = line.match(/^-\s*([^:]+):\s*(.*)$/);
    if (!note) continue;
    const key = note[1].trim().toLowerCase();
    if (notes.has(key)) {
      throw new Error(`Duplicate LAN smoke report note in Notes: ${note[1].trim()}`);
    }
    notes.set(key, note[2].trim());
  }

  return notes;
}

function isNoneNote(value) {
  return value.length === 0 || /^(none|no|n\/a|not applicable)$/i.test(value.trim());
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

  if (!isPrivateIpv4(mac.ip) || !isPrivateIpv4(windows.ip)) {
    throw new Error("Auto-Discovery Run IP/subnet fields must use private LAN IPv4 addresses, not public IPv4 addresses.");
  }

  if (mac.prefix !== windows.prefix) {
    throw new Error("Auto-Discovery Run macOS IP/subnet and Windows IP/subnet must use the same IPv4 CIDR prefix length.");
  }

  if (networkNumber(mac.ip, mac.prefix) !== networkNumber(windows.ip, windows.prefix)) {
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

function isPublicIpLiteral(host) {
  const normalized = host.trim().toLowerCase();
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return !isPrivateOrLocalIpv4(normalized);
  if (ipVersion === 6) {
    const mappedIpv4 = parseIpv4MappedIpv6(normalized);
    if (mappedIpv4) return !isPrivateOrLocalIpv4(mappedIpv4);
    return !isPrivateOrLocalIpv6(normalized);
  }
  return false;
}

function isPrivateOrLocalIpv4(address) {
  const octets = address.split(".").map((part) => Number(part));
  return (
    isPrivateIpv4(address) ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map((part) => Number(part));
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isPrivateOrLocalIpv6(address) {
  return (
    address === "::1" ||
    isUniqueLocalIpv6Literal(address) ||
    isLinkLocalIpv6Literal(address)
  );
}

function isUniqueLocalIpv6Literal(address) {
  const firstSegment = Number.parseInt(address.split(":")[0] || "0", 16);
  return (firstSegment & 0xfe00) === 0xfc00;
}

function isLinkLocalIpv6Literal(address) {
  const normalized = address.trim().toLowerCase();
  if (net.isIP(normalized) !== 6) return false;
  const firstSegment = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return (firstSegment & 0xffc0) === 0xfe80;
}

function parseIpv4MappedIpv6(address) {
  const match = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!match || net.isIP(match[1]) !== 4) return null;
  return match[1];
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
      if (row.length >= 2) {
        if (rows.has(row[0])) {
          throw new Error(`Duplicate LAN smoke report field in ${section}: ${row[0]}`);
        }
        rows.set(row[0], row[1]);
      }
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
