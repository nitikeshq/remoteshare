import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-lan-smoke-report-"));
const verifier = path.resolve("scripts/verify-lan-smoke-report.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

try {
  const valid = writeReport("valid.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: ""
  });
  runVerifier(valid, true, "valid smoke report should pass", "Verified LAN smoke report");

  const explicitStartupNotFailed = writeReport("explicit-startup-not-failed.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoStartupHealth: "ready: TCP ready, UDP ready, start-at-login not failed",
    manualStartupHealth: "ready: TCP ready, UDP ready, start-at-login not failed"
  });
  runVerifier(
    explicitStartupNotFailed,
    true,
    "explicit startup not failed evidence should pass",
    "Verified LAN smoke report"
  );

  const missingField = writeReport("missing-field.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: `| Windows installer file | RemoteShare_${packageVersion}_x64-setup.exe |`
  });
  runVerifier(missingField, false, "missing required field should fail", "Missing Test Context field: Windows installer file");

  const missingLinuxField = writeReport("missing-linux-field.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: `| Linux installer file | RemoteShare_${packageVersion}_amd64.deb |`
  });
  runVerifier(missingLinuxField, false, "missing Linux installer field should fail", "Missing Test Context field: Linux installer file");

  const malformedTestDate = writeReport("malformed-test-date.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    testDate: "June 2, 2026"
  });
  runVerifier(
    malformedTestDate,
    false,
    "malformed test date should fail",
    "Test Context Test date must be an ISO date in YYYY-MM-DD format"
  );

  const invalidTestDate = writeReport("invalid-test-date.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    testDate: "2026-02-31"
  });
  runVerifier(
    invalidTestDate,
    false,
    "invalid test date should fail",
    "Test Context Test date must be a valid calendar date"
  );

  const futureTestDate = writeReport("future-test-date.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    testDate: futureIsoDate()
  });
  runVerifier(
    futureTestDate,
    false,
    "future test date should fail",
    "Test Context Test date cannot be in the future"
  );

  const prefixVersion = writeReport("prefix-version.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    version: `v${packageVersion}0`
  });
  runVerifier(
    prefixVersion,
    false,
    "version prefix should fail",
    "Test Context field must include exact package version"
  );

  const suffixedVersion = writeReport("suffixed-version.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    version: `v${packageVersion}-beta`
  });
  runVerifier(
    suffixedVersion,
    false,
    "version suffix should fail",
    "Test Context field must include exact package version"
  );

  const duplicateContextField = writeReport("duplicate-context-field.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    extraContextRows: [`| Windows installer file | RemoteShare_${packageVersion}_stale.exe |`]
  });
  runVerifier(
    duplicateContextField,
    false,
    "duplicate context field should fail",
    "Duplicate LAN smoke report field in Test Context: Windows installer file"
  );

  const duplicateAutoField = writeReport("duplicate-auto-field.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    extraAutoRows: ["| Pass/fail | Fail |"]
  });
  runVerifier(
    duplicateAutoField,
    false,
    "duplicate auto run field should fail",
    "Duplicate LAN smoke report field in Auto-Discovery Run: Pass/fail"
  );

  const missingAutoTransportContext = writeReport("missing-auto-transport-context.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "| Input Transport source device and relative time shown | Input Transport row shows Mac sender source device and 2 seconds ago |"
  });
  runVerifier(
    missingAutoTransportContext,
    false,
    "missing auto-discovery input transport context should fail",
    "Missing Auto-Discovery Run field: Input Transport source device and relative time shown"
  );

  const missingManualCaptureTiming = writeReport("missing-manual-capture-timing.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "| Active capture target and elapsed start time shown | active target Windows receiver, started 5 seconds ago |"
  });
  runVerifier(
    missingManualCaptureTiming,
    false,
    "missing manual capture timing should fail",
    "Missing Manual Fallback Run field: Active capture target and elapsed start time shown"
  );

  const failedAuto = writeReport("failed-auto.md", {
    autoPass: "Fail",
    manualPass: "Pass",
    omitLine: ""
  });
  runVerifier(failedAuto, false, "failed auto-discovery should fail", "Auto-Discovery Run must be marked Pass");

  const failedWithBlockingIssue = writeReport("failed-with-blocking-issue.md", {
    autoPass: "Fail - tracked issue RS-123",
    manualPass: "Pass",
    omitLine: "",
    notes: ["", "## Notes", "", "- Blocking issues: RS-123"]
  });
  runVerifier(
    failedWithBlockingIssue,
    false,
    "tracked blocking issue should not satisfy release readiness",
    "Auto-Discovery Run must be marked Pass"
  );

  const passedWithBlockingIssue = writeReport("passed-with-blocking-issue.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: ["", "## Notes", "", "- Blocking issues: RS-123"]
  });
  runVerifier(
    passedWithBlockingIssue,
    false,
    "passed report with blocking issue should fail",
    "LAN smoke report Notes must not list unresolved blocking issues for release readiness"
  );

  const passedWithRetestRequired = writeReport("passed-with-retest-required.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: [
      "",
      "## Notes",
      "",
      "- Blocking issues: none",
      "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots",
      "- Retest required: yes after firewall change"
    ]
  });
  runVerifier(
    passedWithRetestRequired,
    false,
    "passed report with retest required should fail",
    "LAN smoke report Notes must not require retest for release readiness"
  );

  const passedWithoutBlockingIssueNotes = writeReport("passed-without-blocking-issue-notes.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: [
      "",
      "## Notes",
      "",
      "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots",
      "- Retest required: no"
    ]
  });
  runVerifier(
    passedWithoutBlockingIssueNotes,
    false,
    "passed report without blocking issue notes should fail",
    "LAN smoke report Notes must include `Blocking issues: none` for release readiness"
  );

  const passedWithoutRetestNotes = writeReport("passed-without-retest-notes.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: [
      "",
      "## Notes",
      "",
      "- Blocking issues: none",
      "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots"
    ]
  });
  runVerifier(
    passedWithoutRetestNotes,
    false,
    "passed report without retest notes should fail",
    "LAN smoke report Notes must include `Retest required: no` for release readiness"
  );

  const passedWithClearNotes = writeReport("passed-with-clear-notes.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: [
      "",
      "## Notes",
      "",
      "- Blocking issues: none",
      "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots",
      "- Retest required: no"
    ]
  });
  runVerifier(
    passedWithClearNotes,
    true,
    "passed report with clear notes should pass",
    "Verified LAN smoke report"
  );

  const duplicateBlockingIssueNotes = writeReport("duplicate-blocking-issue-notes.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: [
      "",
      "## Notes",
      "",
      "- Blocking issues: RS-123",
      "- Blocking issues: none",
      "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots",
      "- Retest required: no"
    ]
  });
  runVerifier(
    duplicateBlockingIssueNotes,
    false,
    "duplicate blocking issue notes should fail",
    "Duplicate LAN smoke report note in Notes: Blocking issues"
  );

  const duplicateRetestNotes = writeReport("duplicate-retest-notes.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: [
      "",
      "## Notes",
      "",
      "- Blocking issues: none",
      "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots",
      "- Retest required: yes after firewall change",
      "- Retest required: no"
    ]
  });
  runVerifier(
    duplicateRetestNotes,
    false,
    "duplicate retest notes should fail",
    "Duplicate LAN smoke report note in Notes: Retest required"
  );

  const passedWithoutCapturedEvidenceNotes = writeReport("passed-without-captured-evidence-notes.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: ["", "## Notes", "", "- Blocking issues: none", "- Screenshots or logs captured:", "- Retest required: no"]
  });
  runVerifier(
    passedWithoutCapturedEvidenceNotes,
    false,
    "passed report without captured evidence notes should fail",
    "LAN smoke report Notes must identify screenshots or logs captured for release evidence"
  );

  const passedWithPartialCapturedEvidenceNotes = writeReport("passed-with-partial-captured-evidence-notes.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    notes: [
      "",
      "## Notes",
      "",
      "- Blocking issues: none",
      "- Screenshots or logs captured: pairing and reconnect screenshots",
      "- Retest required: no"
    ]
  });
  runVerifier(
    passedWithPartialCapturedEvidenceNotes,
    false,
    "passed report with partial captured evidence notes should fail",
    "LAN smoke report Notes screenshots or logs captured must identify pairing, reconnect, input, and capture evidence"
  );

  const failedReconnect = writeReport("failed-reconnect.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoReconnect: "failed"
  });
  runVerifier(
    failedReconnect,
    false,
    "failed reconnect should fail",
    "Auto-Discovery Run reconnect check evidence must paste the reconnect Copy output"
  );

  const positivePrefixFailure = writeReport("positive-prefix-failure.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoPairAction: "started but failed before pairing completed"
  });
  runVerifier(
    positivePrefixFailure,
    false,
    "positive-prefix failure evidence should fail",
    "Auto-Discovery Run field must show success: Pair action started"
  );

  const autoCodeNotTyped = writeReport("auto-code-not-typed.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoCodeTyped: "not typed on Windows"
  });
  runVerifier(
    autoCodeNotTyped,
    false,
    "auto typed-code failure should fail",
    "Auto-Discovery Run field must show success: Six-digit code typed on both machines"
  );

  const manualCodeNotTyped = writeReport("manual-code-not-typed.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualCodeTyped: "not typed on macOS"
  });
  runVerifier(
    manualCodeNotTyped,
    false,
    "manual typed-code failure should fail",
    "Manual Fallback Run field must show success: Six-digit code typed on both machines"
  );

  const vaguePairingEvidence = writeReport("vague-pairing-evidence.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoPairingEvidence: "copied"
  });
  runVerifier(
    vaguePairingEvidence,
    false,
    "vague pairing evidence should fail",
    "Auto-Discovery Run pairing evidence must paste the pending-row copy output"
  );

  const vagueReconnect = writeReport("vague-reconnect.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoReconnect: "succeeded"
  });
  runVerifier(
    vagueReconnect,
    false,
    "vague reconnect should fail",
    "Auto-Discovery Run reconnect check evidence must paste the reconnect Copy output"
  );

  const vagueStartupHealth = writeReport("vague-startup-health.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoStartupHealth: "ready"
  });
  runVerifier(
    vagueStartupHealth,
    false,
    "vague startup health should fail",
    "Auto-Discovery Run startup health evidence must mention TCP ready, UDP ready, and start-at-login not failed"
  );

  const failedStartupHealth = writeReport("failed-startup-health.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoStartupHealth: "ready: TCP ready, UDP ready, start-at-login failed"
  });
  runVerifier(
    failedStartupHealth,
    false,
    "failed startup health should fail",
    "Auto-Discovery Run startup health evidence must mention TCP ready, UDP ready, and start-at-login not failed"
  );

  const vagueAutoEndpointSource = writeReport("vague-auto-endpoint-source.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoEndpointSource: "shown"
  });
  runVerifier(
    vagueAutoEndpointSource,
    false,
    "vague auto endpoint source should fail",
    "Auto-Discovery Run endpoint source evidence must paste the reconnect Copy output"
  );

  const embeddedAutoEndpointSource = writeReport("embedded-auto-endpoint-source.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoEndpointSource: "rediscovery"
  });
  runVerifier(
    embeddedAutoEndpointSource,
    false,
    "embedded auto endpoint source should fail",
    "Auto-Discovery Run endpoint source evidence must paste the reconnect Copy output"
  );

  const vagueManualEndpointSource = writeReport("vague-manual-endpoint-source.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpointSource: "shown"
  });
  runVerifier(
    vagueManualEndpointSource,
    false,
    "vague manual endpoint source should fail",
    "Manual Fallback Run endpoint source evidence must paste the reconnect Copy output"
  );

  const embeddedManualEndpointSource = writeReport("embedded-manual-endpoint-source.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpointSource: "manual ipad"
  });
  runVerifier(
    embeddedManualEndpointSource,
    false,
    "embedded manual endpoint source should fail",
    "Manual Fallback Run endpoint source evidence must paste the reconnect Copy output"
  );

  const savedAutoEndpointSource = writeReport("saved-auto-endpoint-source.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoEndpointSource:
      "after restart; Trusted reconnect; This computer: Mac sender; Auto reconnect: enabled; Device: Windows receiver; Check: reachable; Last seen: now; Endpoint source: saved endpoint; Endpoint: 192.168.1.20:44777; Input control: ready; Last failure: none; Recovery: none"
  });
  runVerifier(
    savedAutoEndpointSource,
    true,
    "auto saved endpoint source should pass",
    "Verified LAN smoke report"
  );

  const contradictoryAutoEndpointSource = writeReport("contradictory-auto-endpoint-source.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoEndpointSource: "not discovery; reconnect failed"
  });
  runVerifier(
    contradictoryAutoEndpointSource,
    false,
    "contradictory auto endpoint source should fail",
    "Auto-Discovery Run endpoint source evidence must paste the reconnect Copy output"
  );

  const contradictoryManualEndpointSource = writeReport("contradictory-manual-endpoint-source.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpointSource: "manual IP failed"
  });
  runVerifier(
    contradictoryManualEndpointSource,
    false,
    "contradictory manual endpoint source should fail",
    "Manual Fallback Run endpoint source evidence must paste the reconnect Copy output"
  );

  const vagueManualDiscovery = writeReport("vague-manual-discovery.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualDiscoveryFallback: "yes"
  });
  runVerifier(
    vagueManualDiscovery,
    false,
    "vague manual discovery fallback should fail",
    "Manual Fallback Run discovery evidence must explain that discovery was disabled, skipped, unavailable, or failed"
  );

  const successfulManualDiscovery = writeReport("successful-manual-discovery.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualDiscoveryFallback: "discovery worked and found the peer"
  });
  runVerifier(
    successfulManualDiscovery,
    false,
    "successful manual discovery fallback should fail",
    "Manual Fallback Run discovery evidence must explain that discovery was disabled, skipped, unavailable, or failed"
  );

  const notDiscoveredManualFallback = writeReport("not-discovered-manual-fallback.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualDiscoveryFallback: "peer not discovered on UDP; used manual fallback"
  });
  runVerifier(
    notDiscoveredManualFallback,
    true,
    "not discovered manual fallback should pass",
    "Verified LAN smoke report"
  );

  const vagueManualEndpointCopy = writeReport("vague-manual-endpoint-copy.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpointCopied: "yes"
  });
  runVerifier(
    vagueManualEndpointCopy,
    false,
    "vague manual endpoint copy should fail",
    "Manual Fallback Run endpoint copy evidence must paste the peer computer's local endpoint Evidence output"
  );

  const missingManualEndpointLabel = writeReport("missing-manual-endpoint-label.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine:
      "| Copied endpoint label shown | Local endpoint; This computer: Windows receiver; Label: Best LAN IPv4; Endpoint: 192.168.1.20:44777; TCP port: 44777; Private network only: enabled |"
  });
  runVerifier(
    missingManualEndpointLabel,
    false,
    "missing manual endpoint label should fail",
    "Missing Manual Fallback Run field: Copied endpoint label shown"
  );

  const vagueManualEndpointLabel = writeReport("vague-manual-endpoint-label.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpointLabel: "recommended endpoint"
  });
  runVerifier(
    vagueManualEndpointLabel,
    false,
    "vague manual endpoint label should fail",
    "Manual Fallback Run copied endpoint label evidence must paste local endpoint Evidence output"
  );

  const vagueManualTcpReachability = writeReport("vague-manual-tcp-reachability.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualTcpReachable: "reachable"
  });
  runVerifier(
    vagueManualTcpReachability,
    false,
    "vague manual TCP reachability should fail",
    "Manual Fallback Run TCP reachability evidence must mention a successful TCP 44777 probe"
  );

  const vagueInputSmoke = writeReport("vague-input-smoke.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoInputSmoke: "delivered"
  });
  runVerifier(
    vagueInputSmoke,
    false,
    "vague input smoke should fail",
    "Auto-Discovery Run input smoke evidence must mention an accepted key press r event"
  );

  const vagueAllowIncomingControl = writeReport("vague-allow-incoming-control.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoAllowIncomingControl: "enabled"
  });
  runVerifier(
    vagueAllowIncomingControl,
    false,
    "vague allow incoming control evidence should fail",
    "Auto-Discovery Run Allow incoming control evidence must paste the receive Copy output"
  );

  const vaguePerDeviceReceive = writeReport("vague-per-device-receive.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualPerDeviceReceive: "enabled"
  });
  runVerifier(
    vaguePerDeviceReceive,
    false,
    "vague per-device receive evidence should fail",
    "Manual Fallback Run per-device Receive evidence must paste the receive Copy output"
  );

  const vagueInputTransportContext = writeReport("vague-input-transport-context.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoInputTransportContext: "visible"
  });
  runVerifier(
    vagueInputTransportContext,
    false,
    "vague input transport context should fail",
    "Auto-Discovery Run input transport evidence must mention the source device and relative time shown in the receiver UI"
  );

  const vagueFingerprint = writeReport("vague-fingerprint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoFingerprint: "Pass - compared"
  });
  runVerifier(
    vagueFingerprint,
    false,
    "vague fingerprint evidence should fail",
    "Auto-Discovery Run fingerprint evidence must mention full local and peer fingerprints copied or compared from the audit view"
  );

  const localOnlyFingerprint = writeReport("local-only-fingerprint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoFingerprint: "Pass - Trusted Device Audit copied full local fingerprint"
  });
  runVerifier(
    localOnlyFingerprint,
    false,
    "local-only fingerprint evidence should fail",
    "Auto-Discovery Run fingerprint evidence must mention full local and peer fingerprints copied or compared from the audit view"
  );

  const peerOnlyFingerprint = writeReport("peer-only-fingerprint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoFingerprint: "Pass - Trusted Device Audit copied full peer fingerprint"
  });
  runVerifier(
    peerOnlyFingerprint,
    false,
    "peer-only fingerprint evidence should fail",
    "Auto-Discovery Run fingerprint evidence must mention full local and peer fingerprints copied or compared from the audit view"
  );

  const vagueCaptureStartStop = writeReport("vague-capture-start-stop.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoCaptureStartStop: "started"
  });
  runVerifier(
    vagueCaptureStartStop,
    false,
    "vague capture start-stop should fail",
    "Auto-Discovery Run capture evidence must show capture started and stopped cleanly"
  );

  const vagueCaptureTiming = writeReport("vague-capture-timing.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoCaptureTiming: "visible"
  });
  runVerifier(
    vagueCaptureTiming,
    false,
    "vague capture timing should fail",
    "Auto-Discovery Run capture timing evidence must mention the active capture target and elapsed start time shown in the sender UI"
  );

  const vagueCaptureEvents = writeReport("vague-capture-events.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoCaptureEvents: "accepted key event"
  });
  runVerifier(
    vagueCaptureEvents,
    false,
    "vague capture event coverage should fail",
    "Auto-Discovery Run capture evidence must mention accepted mouse move, mouse click, scroll, and key events"
  );

  const vagueFailureReason = writeReport("vague-failure-reason.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoFailureReason: "visible"
  });
  runVerifier(
    vagueFailureReason,
    false,
    "vague failure reason evidence should fail",
    "Auto-Discovery Run failure reason evidence must say none/no failure, or mention the visible UI diagnostic or recovery hint shown before retry"
  );

  const noFailureObserved = writeReport("no-failure-observed.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoFailureReason: "no failure observed",
    manualFailureReason: "none before retry"
  });
  runVerifier(
    noFailureObserved,
    true,
    "qualified no-failure evidence should pass",
    "Verified LAN smoke report"
  );

  const ambiguousNoFailure = writeReport("ambiguous-no-failure.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoFailureReason: "no problem"
  });
  runVerifier(
    ambiguousNoFailure,
    false,
    "ambiguous no-failure evidence should fail",
    "Auto-Discovery Run failure reason evidence must say none/no failure, or mention the visible UI diagnostic or recovery hint shown before retry"
  );

  const vagueManualFailureReason = writeReport("vague-manual-failure-reason.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualFailureReason: "visible endpoint failure before retry"
  });
  runVerifier(
    vagueManualFailureReason,
    false,
    "vague manual failure reason should fail",
    "Manual Fallback Run failure reason evidence must mention the manual IP, Set IP / Verify IP, copied endpoint, TCP 44777, or firewall recovery path"
  );

  const manualIpRecoveryFailureReason = writeReport("manual-ip-recovery-failure-reason.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualFailureReason: "Visible recovery hint: Manual IP verification failed; checked copied endpoint, firewall, and port 44777 before Set IP / Verify IP retry"
  });
  runVerifier(
    manualIpRecoveryFailureReason,
    false,
    "manual IP recovery without trusted copy output should fail",
    "Manual Fallback Run retry evidence must paste the trusted IP update Copy output"
  );

  const trustedIpUpdateCopyFailureReason = writeReport("trusted-ip-update-copy-failure-reason.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualFailureReason:
      "Visible recovery hint before retry. Trusted IP update; Device: Windows receiver; Endpoint field: 192.168.1.20:44777; Current endpoint: 192.168.1.99:44777; Current source: saved endpoint; Input control: ready; Last failure: Manual IP verification failed on TCP 44777; Recovery: Copy the current endpoint from the other computer, then use Set IP and Verify IP"
  });
  runVerifier(
    trustedIpUpdateCopyFailureReason,
    true,
    "trusted IP update copy failure reason should pass",
    "Verified LAN smoke report"
  );

  const noneSuccess = writeReport("none-success.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    autoPairAction: "none"
  });
  runVerifier(
    noneSuccess,
    false,
    "none should not satisfy success evidence",
    "Auto-Discovery Run field must show success: Pair action started"
  );

  const wrongReportVersion = writeReport("wrong-report-version.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    version: "v9.9.9"
  });
  runVerifier(
    wrongReportVersion,
    false,
    "wrong report version should fail",
    `Test Context field must include exact package version ${packageVersion}`
  );

  const wrongInputDirection = writeReport("wrong-input-direction.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    inputDirection: "Windows sender/main -> macOS receiver/client"
  });
  runVerifier(
    wrongInputDirection,
    false,
    "wrong input direction should fail",
    "Test Context Input direction must be macOS sender/main -> Windows receiver/client"
  );

  const wrongMacRole = writeReport("wrong-mac-role.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    macRole: "Client"
  });
  runVerifier(
    wrongMacRole,
    false,
    "wrong macOS role should fail",
    "Test Context macOS role shown must be Main"
  );

  const wrongWindowsRole = writeReport("wrong-windows-role.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    windowsRole: "Main"
  });
  runVerifier(
    wrongWindowsRole,
    false,
    "wrong Windows role should fail",
    "Test Context Windows role shown must be Client"
  );

  const blockedFirewall = writeReport("blocked-firewall.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    windowsFirewallStatus: "blocked"
  });
  runVerifier(
    blockedFirewall,
    false,
    "blocked firewall should fail",
    "Test Context field must show success: Windows firewall status"
  );

  const deniedInputMonitoring = writeReport("denied-input-monitoring.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    macosInputMonitoringPermission: "denied"
  });
  runVerifier(
    deniedInputMonitoring,
    false,
    "denied input monitoring should fail",
    "Test Context field must show success: macOS Input Monitoring permission"
  );

  const wrongInstallerVersion = writeReport("wrong-installer-version.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    linuxInstaller: "RemoteShare_9.9.9_amd64.deb"
  });
  runVerifier(
    wrongInstallerVersion,
    false,
    "wrong installer version should fail",
    `Test Context installer filename must include package version ${packageVersion}: Linux installer file`
  );

  const wrongInstallerExtension = writeReport("wrong-installer-extension.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    macInstaller: `RemoteShare_${packageVersion}_aarch64.zip`
  });
  runVerifier(
    wrongInstallerExtension,
    false,
    "wrong installer extension should fail",
    "Test Context installer filename must end with .dmg: macOS installer file"
  );

  const invalidSha = writeReport("invalid-sha.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    windowsSha: "not-a-sha256"
  });
  runVerifier(
    invalidSha,
    false,
    "invalid installer sha should fail",
    "Test Context field must be a 64-character SHA-256 hex value: Windows installer SHA256"
  );

  const wrongManualEndpointPort = writeReport("wrong-manual-endpoint-port.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpoint: "192.168.1.20:12345"
  });
  runVerifier(
    wrongManualEndpointPort,
    false,
    "wrong manual endpoint port should fail",
    "Manual Fallback Run field must use TCP port 44777: Endpoint used"
  );

  const localhostManualEndpoint = writeReport("localhost-manual-endpoint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpoint: "localhost:44777"
  });
  runVerifier(
    localhostManualEndpoint,
    false,
    "localhost manual endpoint should fail",
    "Manual Fallback Run field must use the peer computer endpoint"
  );

  const hostnameManualEndpoint = writeReport("hostname-manual-endpoint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpoint: "windows-client.local:44777"
  });
  runVerifier(
    hostnameManualEndpoint,
    false,
    "hostname manual endpoint should fail",
    "Manual Fallback Run field must use a private IPv4 or unique-local IPv6 endpoint literal"
  );

  const publicManualEndpoint = writeReport("public-manual-endpoint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpoint: "8.8.8.8:44777"
  });
  runVerifier(
    publicManualEndpoint,
    false,
    "public manual endpoint should fail",
    "Manual Fallback Run field must not use a public IP literal while Private network only is enabled"
  );

  const linkLocalIpv6ManualEndpoint = writeReport("link-local-ipv6-manual-endpoint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpoint: "[fe80::20]:44777"
  });
  runVerifier(
    linkLocalIpv6ManualEndpoint,
    false,
    "link-local IPv6 manual endpoint should fail",
    "Manual Fallback Run field must not use a link-local IPv6 literal"
  );

  const ipv6ManualEndpoint = writeReport("ipv6-manual-endpoint.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    manualEndpoint: "[fd00::20]:44777",
    localEndpointEvidence:
      "Local endpoint; This computer: Windows receiver; Label: LAN IPv6; Endpoint: [fd00::20]:44777; TCP port: 44777; Private network only: enabled"
  });
  runVerifier(
    ipv6ManualEndpoint,
    true,
    "bracketed IPv6 manual endpoint should pass",
    "Verified LAN smoke report"
  );

  const malformedAutoSubnet = writeReport("malformed-auto-subnet.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    macIpSubnet: "192.168.1.10"
  });
  runVerifier(
    malformedAutoSubnet,
    false,
    "malformed auto-discovery CIDR should fail",
    "Auto-Discovery Run field must use IPv4 CIDR notation like 192.168.1.10/24: macOS IP/subnet"
  );

  const differentAutoSubnet = writeReport("different-auto-subnet.md", {
    autoPass: "Pass",
    manualPass: "Pass",
    omitLine: "",
    macIpSubnet: "192.168.1.10/24",
    windowsIpSubnet: "192.168.2.20/24"
  });
  runVerifier(
    differentAutoSubnet,
    false,
    "different auto-discovery subnet should fail",
    "Auto-Discovery Run macOS IP/subnet and Windows IP/subnet must be on the same IPv4 subnet"
  );

  console.log("LAN smoke report verifier tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeReport(name, options) {
  const file = path.join(root, name);
  const autoReconnectEvidence =
    "after restart; Trusted reconnect; This computer: Mac sender; Auto reconnect: enabled; Device: Windows receiver; Check: reachable; Last seen: now; Endpoint source: discovery; Endpoint: 192.168.1.20:44777; Input control: ready; Last failure: none; Recovery: none";
  const manualReconnectEvidence =
    "after restart; Trusted reconnect; This computer: Mac sender; Auto reconnect: enabled; Device: Windows receiver; Check: reachable; Last seen: now; Endpoint source: saved endpoint; Endpoint: 192.168.1.20:44777; Input control: ready; Last failure: none; Recovery: none";
  const autoReconnect = options.autoReconnect ?? autoReconnectEvidence;
  const manualReconnect = options.manualReconnect ?? manualReconnectEvidence;
  const autoReconnectEnabled = options.autoReconnectEnabled ?? autoReconnectEvidence;
  const manualReconnectEnabled = options.manualReconnectEnabled ?? manualReconnectEvidence;
  const autoStartupHealth = options.autoStartupHealth ?? "ready: TCP ready, UDP ready, start-at-login ok";
  const manualStartupHealth = options.manualStartupHealth ?? "ready: TCP ready, UDP ready, start-at-login ok";
  const autoEndpointSource = options.autoEndpointSource ?? autoReconnectEvidence;
  const manualEndpointSource = options.manualEndpointSource ?? manualReconnectEvidence;
  const autoInputSmoke = options.autoInputSmoke ?? "accepted key press r delivered";
  const manualInputSmoke = options.manualInputSmoke ?? "accepted key press r delivered";
  const autoAllowIncomingControl =
    options.autoAllowIncomingControl ??
    "Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready";
  const manualAllowIncomingControl =
    options.manualAllowIncomingControl ??
    "Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready";
  const autoPerDeviceReceive =
    options.autoPerDeviceReceive ??
    "Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready";
  const manualPerDeviceReceive =
    options.manualPerDeviceReceive ??
    "Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready";
  const autoInputTransportContext =
    options.autoInputTransportContext ?? "Input Transport row shows Mac sender source device and 2 seconds ago";
  const manualInputTransportContext =
    options.manualInputTransportContext ?? "Input Transport row shows Mac sender source device and 3 seconds ago";
  const autoFingerprint =
    options.autoFingerprint ?? "Pass - Trusted Device Audit copied full local and peer fingerprints";
  const manualFingerprint =
    options.manualFingerprint ?? "Pass - Trusted Device Audit copied full local and peer fingerprints";
  const autoCaptureStartStop = options.autoCaptureStartStop ?? "started and stopped cleanly";
  const manualCaptureStartStop = options.manualCaptureStartStop ?? "started and stopped cleanly";
  const autoCaptureTiming =
    options.autoCaptureTiming ?? "active target Windows receiver, started 4 seconds ago";
  const manualCaptureTiming =
    options.manualCaptureTiming ?? "active target Windows receiver, started 5 seconds ago";
  const autoCaptureEvents = options.autoCaptureEvents ?? "accepted mouse move, mouse click, scroll, and key events";
  const manualCaptureEvents = options.manualCaptureEvents ?? "accepted mouse move, mouse click, scroll, and key events";
  const autoFailureReason = options.autoFailureReason ?? "none";
  const manualFailureReason = options.manualFailureReason ?? "none";
  const version = options.version ?? `v${packageVersion}`;
  const macInstaller = options.macInstaller ?? `RemoteShare_${packageVersion}_aarch64.dmg`;
  const windowsInstaller = options.windowsInstaller ?? `RemoteShare_${packageVersion}_x64-setup.exe`;
  const linuxInstaller = options.linuxInstaller ?? `RemoteShare_${packageVersion}_amd64.deb`;
  const macSha = options.macSha ?? "0".concat("a".repeat(63));
  const windowsSha = options.windowsSha ?? "0".concat("b".repeat(63));
  const linuxSha = options.linuxSha ?? "0".concat("c".repeat(63));
  const manualEndpoint = options.manualEndpoint ?? "192.168.1.20:44777";
  const localEndpointEvidence =
    options.localEndpointEvidence ??
    "Local endpoint; This computer: Windows receiver; Label: Best LAN IPv4; Endpoint: 192.168.1.20:44777; TCP port: 44777; Private network only: enabled";
  const manualDiscoveryFallback =
    options.manualDiscoveryFallback ?? "discovery skipped for manual fallback";
  const manualEndpointCopied =
    options.manualEndpointCopied ?? localEndpointEvidence;
  const manualEndpointLabel =
    options.manualEndpointLabel ?? localEndpointEvidence;
  const manualTcpReachable =
    options.manualTcpReachable ?? "reachable on TCP 44777 via Test-NetConnection TcpTestSucceeded";
  const autoPairAction = options.autoPairAction ?? "started";
  const autoCodeTyped = options.autoCodeTyped ?? "confirmed";
  const autoPairingEvidence =
    options.autoPairingEvidence ??
    "Pairing: Outgoing; Device: Windows receiver; Endpoint: 192.168.1.20:44777; Visible code: 123456; Typed code state: Codes match; Local: approved; Remote: pending; Expires: 86s left";
  const manualCodeTyped = options.manualCodeTyped ?? "confirmed";
  const manualPairingEvidence =
    options.manualPairingEvidence ??
    "Pairing: Incoming; Device: Windows receiver; Endpoint: 192.168.1.20:44777; Visible code: 123456; Typed code state: Codes match; Local: approved; Remote: pending; Expires: 84s left";
  const macIpSubnet = options.macIpSubnet ?? "192.168.1.10/24";
  const windowsIpSubnet = options.windowsIpSubnet ?? "192.168.1.20/24";
  const inputDirection = options.inputDirection ?? "macOS sender/main -> Windows receiver/client";
  const macRole = options.macRole ?? "Main shown in this computer role";
  const windowsRole = options.windowsRole ?? "Client shown in peer role";
  const macosFirewallStatus = options.macosFirewallStatus ?? "allowed";
  const windowsFirewallStatus = options.windowsFirewallStatus ?? "allowed";
  const macosAccessibilityPermission = options.macosAccessibilityPermission ?? "enabled";
  const macosInputMonitoringPermission = options.macosInputMonitoringPermission ?? "enabled";
  const testDate = options.testDate ?? "2026-06-02";
  const extraContextRows = options.extraContextRows ?? [];
  const extraAutoRows = options.extraAutoRows ?? [];
  const extraManualRows = options.extraManualRows ?? [];
  const notes = options.notes ?? [
    "",
    "## Notes",
    "",
    "- Blocking issues: none",
    "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots",
    "- Retest required: no"
  ];
  const lines = [
    "# LAN Smoke Report",
    "",
    "## Test Context",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Test date | ${testDate} |`,
    "| Tester | QA |",
    `| RemoteShare version/tag | ${version} |`,
    `| Input direction | ${inputDirection} |`,
    `| macOS role shown | ${macRole} |`,
    `| Windows role shown | ${windowsRole} |`,
    "| macOS model/version | MacBook / macOS 15 |",
    "| Windows model/version | PC / Windows 11 |",
    ...extraContextRows,
    `| macOS installer file | ${macInstaller} |`,
    `| macOS installer SHA256 | ${macSha} |`,
    `| Windows installer file | ${windowsInstaller} |`,
    `| Windows installer SHA256 | ${windowsSha} |`,
    `| Linux installer file | ${linuxInstaller} |`,
    `| Linux installer SHA256 | ${linuxSha} |`,
    "| Router/SSID/band | Lab Wi-Fi / 5 GHz |",
    "| Same subnet confirmed | yes |",
    `| macOS firewall status | ${macosFirewallStatus} |`,
    `| Windows firewall status | ${windowsFirewallStatus} |`,
    `| macOS Accessibility permission | ${macosAccessibilityPermission} |`,
    `| macOS Input Monitoring permission | ${macosInputMonitoringPermission} |`,
    "",
    "## Auto-Discovery Run",
    "",
    "| Field | Result |",
    "| --- | --- |",
    `| macOS IP/subnet | ${macIpSubnet} |`,
    `| Windows IP/subnet | ${windowsIpSubnet} |`,
    "| Peer appeared in `Scan LAN` | yes |",
    `| Pair action started | ${autoPairAction} |`,
    "| Same six-digit code shown on both machines | confirmed |",
    `| Six-digit code typed on both machines | ${autoCodeTyped} |`,
    `| Pairing evidence copied from pending row | ${autoPairingEvidence} |`,
    "| `Trusted` shown on both machines | shown |",
    `| Full fingerprint copied or visually compared | ${autoFingerprint} |`,
    `| \`Auto reconnect\` enabled after restart/wake | ${autoReconnectEnabled} |`,
    `| Startup health shows TCP ready, UDP ready, and start-at-login not failed | ${autoStartupHealth} |`,
    `| \`Check\` succeeded after restart/wake | ${autoReconnect} |`,
    `| Endpoint source shown | ${autoEndpointSource} |`,
    `| \`Allow incoming control\` enabled on receiver | ${autoAllowIncomingControl} |`,
    `| Per-device \`Receive\` enabled | ${autoPerDeviceReceive} |`,
    `| Sender \`Test\` delivered accepted \`key press r\` input event | ${autoInputSmoke} |`,
    `| Input Transport source device and relative time shown | ${autoInputTransportContext} |`,
    `| Capture started on sender and stopped cleanly | ${autoCaptureStartStop} |`,
    `| Active capture target and elapsed start time shown | ${autoCaptureTiming} |`,
    `| Captured mouse move, mouse click, scroll, and key events accepted on receiver | ${autoCaptureEvents} |`,
    `| Failure reason visible before retry | ${autoFailureReason} |`,
    ...extraAutoRows,
    `| Pass/fail | ${options.autoPass} |`,
    "",
    "## Manual Fallback Run",
    "",
    "| Field | Result |",
    "| --- | --- |",
    `| Discovery disabled, skipped, or failed | ${manualDiscoveryFallback} |`,
    `| Manual endpoint copied from peer \`This computer\` row | ${manualEndpointCopied} |`,
    `| Copied endpoint label shown | ${manualEndpointLabel} |`,
    `| Endpoint used | ${manualEndpoint} |`,
    `| TCP \`44777\` reachable | ${manualTcpReachable} |`,
    "| Pair action started | started |",
    "| Same six-digit code shown on both machines | confirmed |",
    `| Six-digit code typed on both machines | ${manualCodeTyped} |`,
    `| Pairing evidence copied from pending row | ${manualPairingEvidence} |`,
    "| `Trusted` shown on both machines | shown |",
    `| Full fingerprint copied or visually compared | ${manualFingerprint} |`,
    `| \`Auto reconnect\` enabled after restart/wake | ${manualReconnectEnabled} |`,
    `| Startup health shows TCP ready, UDP ready, and start-at-login not failed | ${manualStartupHealth} |`,
    `| \`Check\` succeeded after restart/wake | ${manualReconnect} |`,
    `| Endpoint source shown as saved endpoint or manual IP | ${manualEndpointSource} |`,
    `| \`Allow incoming control\` enabled on receiver | ${manualAllowIncomingControl} |`,
    `| Per-device \`Receive\` enabled | ${manualPerDeviceReceive} |`,
    `| Sender \`Test\` delivered accepted \`key press r\` input event | ${manualInputSmoke} |`,
    `| Input Transport source device and relative time shown | ${manualInputTransportContext} |`,
    `| Capture started on sender and stopped cleanly | ${manualCaptureStartStop} |`,
    `| Active capture target and elapsed start time shown | ${manualCaptureTiming} |`,
    `| Captured mouse move, mouse click, scroll, and key events accepted on receiver | ${manualCaptureEvents} |`,
    `| Failure reason visible before retry | ${manualFailureReason} |`,
    ...extraManualRows,
    `| Pass/fail | ${options.manualPass} |`,
    ...notes
  ].filter((line) => line !== options.omitLine);

  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

function futureIsoDate() {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function runVerifier(file, shouldPass, label, expectedOutput) {
  const result = spawnSync(process.execPath, [verifier, file], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  if (!output.includes(expectedOutput)) {
    throw new Error(`${label}: expected output to include ${expectedOutput}\n${output}`);
  }
}
