import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-readiness-"));
const verifier = path.resolve("scripts/verify-release-readiness.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = "2026-06-01T10:00:00.000Z";

try {
  const releaseAssets = releaseFixture("release-assets");
  const smokeReport = smokeReportFixture("lan-smoke.md", "Pass");
  runVerifier(
    releaseAssets,
    smokeReport,
    true,
    "valid release readiness inputs should pass",
    "Verified release readiness"
  );

  const missingManifestAssets = releaseFixture("missing-manifest");
  fs.rmSync(path.join(missingManifestAssets, "RELEASE-MANIFEST.json"));
  runVerifier(
    missingManifestAssets,
    smokeReport,
    false,
    "missing release manifest should fail",
    "Release readiness release manifest check failed"
  );

  const tamperedArtifactAssets = releaseFixture("tampered-artifact");
  fs.writeFileSync(
    path.join(tamperedArtifactAssets, `RemoteShare_${packageVersion}_x64-setup.exe`),
    "tampered exe"
  );
  runVerifier(
    tamperedArtifactAssets,
    smokeReport,
    false,
    "tampered release artifact should fail",
    "Manifest size mismatch"
  );

  const staleChecksumAssets = releaseFixture("stale-checksum");
  fs.appendFileSync(
    path.join(staleChecksumAssets, "SHA256SUMS.txt"),
    `${sha256("stale")}  RemoteShare_${packageVersion}_stale.dmg\n`
  );
  runVerifier(
    staleChecksumAssets,
    smokeReport,
    false,
    "stale release checksum should fail",
    "Checksum file contains stale entry not present in manifest"
  );

  const unmanifestedInstallerAssets = releaseFixture("unmanifested-installer");
  fs.writeFileSync(
    path.join(unmanifestedInstallerAssets, `RemoteShare_${packageVersion}_extra.dmg`),
    "unmanifested dmg"
  );
  runVerifier(
    unmanifestedInstallerAssets,
    smokeReport,
    false,
    "unmanifested release installer should fail",
    "Release assets contain installer artifact(s) not present in manifest"
  );

  const unexpectedInstallerAssets = releaseFixture("unexpected-installer");
  fs.writeFileSync(
    path.join(unexpectedInstallerAssets, `RemoteShare_${packageVersion}_x64.msi`),
    "unexpected msi"
  );
  runVerifier(
    unexpectedInstallerAssets,
    smokeReport,
    false,
    "unexpected release installer should fail",
    "Release assets contain unexpected installer artifact(s)"
  );

  const missingSummaryAssets = releaseFixture("missing-summary");
  fs.rmSync(path.join(missingSummaryAssets, "release-candidate-summary.md"));
  runVerifier(
    missingSummaryAssets,
    smokeReport,
    false,
    "missing release candidate summary should fail",
    "Missing release candidate summary"
  );

  const missingPrefilledSmokeAssets = releaseFixture("missing-prefilled-smoke");
  fs.rmSync(path.join(missingPrefilledSmokeAssets, "lan-smoke-report.md"));
  runVerifier(
    missingPrefilledSmokeAssets,
    smokeReport,
    false,
    "missing prefilled LAN smoke report should fail",
    "Missing prefilled LAN smoke report"
  );

  const mismatchedPrefilledSmokeAssets = releaseFixture("mismatched-prefilled-smoke");
  fs.writeFileSync(
    path.join(mismatchedPrefilledSmokeAssets, "lan-smoke-report.md"),
    "# stale smoke report\n"
  );
  runVerifier(
    mismatchedPrefilledSmokeAssets,
    smokeReport,
    false,
    "mismatched prefilled LAN smoke report should fail",
    "Prefilled LAN smoke report must match release assets, manifest, and template"
  );

  const mismatchedSummaryAssets = releaseFixture("mismatched-summary");
  fs.writeFileSync(
    path.join(mismatchedSummaryAssets, "release-candidate-summary.md"),
    "# stale summary\n"
  );
  runVerifier(
    mismatchedSummaryAssets,
    smokeReport,
    false,
    "mismatched release candidate summary should fail",
    "Release candidate summary must match release assets and manifest"
  );

  const failedSmokeReport = smokeReportFixture("failed-smoke.md", "Fail");
  runVerifier(
    releaseAssets,
    failedSmokeReport,
    false,
    "failed LAN smoke report should fail",
    "Release readiness LAN smoke report check failed"
  );

  const missingCapturedEvidenceReport = smokeReportFixture("missing-captured-evidence.md", "Pass", {
    includeCapturedEvidenceNote: false
  });
  runVerifier(
    releaseAssets,
    missingCapturedEvidenceReport,
    false,
    "missing LAN smoke captured evidence notes should fail",
    "Notes must identify screenshots or logs captured for release evidence"
  );

  const mismatchedInstallerReport = smokeReportFixture("mismatched-installer.md", "Pass", {
    macInstaller: `RemoteShare_${packageVersion}_wrong.dmg`
  });
  runVerifier(
    releaseAssets,
    mismatchedInstallerReport,
    false,
    "mismatched LAN smoke installer should fail",
    "macOS installer file must match release dmg artifact"
  );

  const mismatchedWindowsInstallerReport = smokeReportFixture("mismatched-windows-installer.md", "Pass", {
    windowsInstaller: `RemoteShare_${packageVersion}_wrong.exe`
  });
  runVerifier(
    releaseAssets,
    mismatchedWindowsInstallerReport,
    false,
    "mismatched LAN smoke Windows installer should fail",
    "Windows installer file must match release exe artifact"
  );

  const mismatchedLinuxInstallerReport = smokeReportFixture("mismatched-linux-installer.md", "Pass", {
    linuxInstaller: `RemoteShare_${packageVersion}_wrong.deb`
  });
  runVerifier(
    releaseAssets,
    mismatchedLinuxInstallerReport,
    false,
    "mismatched LAN smoke Linux installer should fail",
    "Linux installer file must match release deb artifact"
  );

  const mismatchedVersionReport = smokeReportFixture("mismatched-version.md", "Pass", {
    version: "v9.9.9"
  });
  runVerifier(
    releaseAssets,
    mismatchedVersionReport,
    false,
    "mismatched LAN smoke version should fail",
    "RemoteShare version/tag"
  );

  const prefixVersionReport = smokeReportFixture("prefix-version.md", "Pass", {
    version: `v${packageVersion}0`
  });
  runVerifier(
    releaseAssets,
    prefixVersionReport,
    false,
    "LAN smoke version prefix should fail",
    "must include exact package version"
  );

  const suffixedVersionReport = smokeReportFixture("suffixed-version.md", "Pass", {
    version: `v${packageVersion}-beta`
  });
  runVerifier(
    releaseAssets,
    suffixedVersionReport,
    false,
    "LAN smoke version suffix should fail",
    "must include exact package version"
  );

  const staleDateReport = smokeReportFixture("stale-date.md", "Pass", {
    testDate: "2026-05-31"
  });
  runVerifier(
    releaseAssets,
    staleDateReport,
    false,
    "stale LAN smoke test date should fail",
    "Test date must be on or after release manifest date 2026-06-01"
  );

  const malformedDateReport = smokeReportFixture("malformed-date.md", "Pass", {
    testDate: "June 2, 2026"
  });
  runVerifier(
    releaseAssets,
    malformedDateReport,
    false,
    "malformed LAN smoke test date should fail",
    "Test date must be an ISO date"
  );

  const futureDateReport = smokeReportFixture("future-date.md", "Pass", {
    testDate: futureIsoDate()
  });
  runVerifier(
    releaseAssets,
    futureDateReport,
    false,
    "future LAN smoke test date should fail",
    "Test date cannot be in the future"
  );

  const missingGeneratedAtAssets = releaseFixture("missing-generated-at");
  const missingGeneratedAtManifestPath = path.join(missingGeneratedAtAssets, "RELEASE-MANIFEST.json");
  const missingGeneratedAtManifest = JSON.parse(fs.readFileSync(missingGeneratedAtManifestPath, "utf8"));
  delete missingGeneratedAtManifest.generatedAt;
  fs.writeFileSync(missingGeneratedAtManifestPath, `${JSON.stringify(missingGeneratedAtManifest, null, 2)}\n`);
  runVerifier(
    missingGeneratedAtAssets,
    smokeReport,
    false,
    "missing release manifest generatedAt should fail",
    "generatedAt must be a valid ISO-8601 UTC timestamp"
  );

  const mismatchedHashReport = smokeReportFixture("mismatched-hash.md", "Pass", {
    macSha256: sha256("wrong dmg")
  });
  runVerifier(
    releaseAssets,
    mismatchedHashReport,
    false,
    "mismatched LAN smoke checksum should fail",
    "macOS installer SHA256 must match release dmg sha256"
  );

  const duplicateContextReport = smokeReportFixture("duplicate-context-row.md", "Pass", {
    extraContextRows: `| macOS installer file | RemoteShare_${packageVersion}_stale.dmg |\n`
  });
  runVerifier(
    releaseAssets,
    duplicateContextReport,
    false,
    "duplicate LAN smoke context rows should fail",
    "Duplicate LAN smoke report field in Test Context: macOS installer file"
  );

  const mismatchedWindowsHashReport = smokeReportFixture("mismatched-windows-hash.md", "Pass", {
    windowsSha256: sha256("wrong exe")
  });
  runVerifier(
    releaseAssets,
    mismatchedWindowsHashReport,
    false,
    "mismatched LAN smoke Windows checksum should fail",
    "Windows installer SHA256 must match release exe sha256"
  );

  const mismatchedLinuxHashReport = smokeReportFixture("mismatched-linux-hash.md", "Pass", {
    linuxSha256: sha256("wrong deb")
  });
  runVerifier(
    releaseAssets,
    mismatchedLinuxHashReport,
    false,
    "mismatched LAN smoke Linux checksum should fail",
    "Linux installer SHA256 must match release deb sha256"
  );

  console.log("Release readiness verifier tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function releaseFixture(name) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const artifacts = [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ].map(([type, file, body]) => {
    fs.writeFileSync(path.join(directory, file), body);
    return {
      file,
      sha256: sha256(body),
      sizeBytes: Buffer.byteLength(body),
      type
    };
  });

  fs.writeFileSync(
    path.join(directory, "SHA256SUMS.txt"),
    `${artifacts
      .map((artifact) => `${artifact.sha256}  ${artifact.file}`)
      .sort()
      .join("\n")}\n`
  );
  fs.writeFileSync(
    path.join(directory, "RELEASE-MANIFEST.json"),
    `${JSON.stringify(
      {
        version: packageVersion,
        generatedAt,
        artifacts: artifacts.sort((a, b) => a.type.localeCompare(b.type))
      },
      null,
      2
    )}\n`
  );
  prepareReleaseCandidateSummary(directory);
  preparePrefilledLanSmokeReport(directory);

  return directory;
}

function prepareReleaseCandidateSummary(directory) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/release-candidate-summary.mjs",
      directory,
      path.join(directory, "release-candidate-summary.md")
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to prepare release candidate summary fixture.\n${result.stdout}\n${result.stderr}`);
  }
}

function preparePrefilledLanSmokeReport(directory) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/prepare-lan-smoke-report.mjs",
      directory,
      path.join(directory, "lan-smoke-report.md")
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to prepare prefilled LAN smoke report fixture.\n${result.stdout}\n${result.stderr}`);
  }
}

function smokeReportFixture(name, passValue, options = {}) {
  const file = path.join(root, name);
  const macInstaller = options.macInstaller ?? `RemoteShare_${packageVersion}_aarch64.dmg`;
  const windowsInstaller = options.windowsInstaller ?? `RemoteShare_${packageVersion}_x64-setup.exe`;
  const linuxInstaller = options.linuxInstaller ?? `RemoteShare_${packageVersion}_amd64.deb`;
  const macSha256 = options.macSha256 ?? sha256("valid dmg");
  const windowsSha256 = options.windowsSha256 ?? sha256("valid exe");
  const linuxSha256 = options.linuxSha256 ?? sha256("valid deb");
  const version = options.version ?? `v${packageVersion}`;
  const testDate = options.testDate ?? "2026-06-02";
  const extraContextRows = options.extraContextRows ?? "";
  const autoReconnectEvidence =
    "after restart; Trusted reconnect; This computer: Mac sender; Auto reconnect: enabled; Device: Windows receiver; Check: reachable; Last seen: now; Endpoint source: discovery; Endpoint: 192.168.1.20:44777; Input control: ready; Last failure: none; Recovery: none";
  const manualReconnectEvidence =
    "after restart; Trusted reconnect; This computer: Mac sender; Auto reconnect: enabled; Device: Windows receiver; Check: reachable; Last seen: now; Endpoint source: saved endpoint; Endpoint: 192.168.1.20:44777; Input control: ready; Last failure: none; Recovery: none";
  const localEndpointEvidence =
    "Local endpoint; This computer: Windows receiver; Label: Best LAN IPv4; Endpoint: 192.168.1.20:44777; TCP port: 44777; Private network only: enabled";
  const macSetupEvidence =
    "Setup; Input direction: macOS sender/main -> Windows receiver/client; This computer: Mac sender; Platform: macos; Role: Main; Choose roles: done - Set this Mac to Main; Mac input permissions: done - Accessibility and Input Monitoring granted; Find Windows client: done - Windows client trusted; Trust the pair: done - Type the same six-digit code and confirm on both computers.; Windows receive setup: done - Windows client receive ready; Verify input: done - key press r accepted";
  const windowsSetupEvidence =
    "Setup; Input direction: macOS sender/main -> Windows receiver/client; This computer: Windows receiver; Platform: windows; Role: Client; Choose roles: done - Set this Windows computer to Client; Windows receive ready: done - Native input injection ready; Find Mac sender: done - Mac sender trusted; Trust the pair: done - Type the same six-digit code and confirm on both computers.; Local receive permission: done - Allow incoming control and Receive enabled; Verify input: done - key press r accepted";
  const capturedEvidenceNote =
    options.includeCapturedEvidenceNote === false
      ? ""
      : "- Screenshots or logs captured: pairing, reconnect, input, and capture screenshots\n";
  fs.writeFileSync(
    file,
    `# LAN Smoke Report

## Test Context

| Field | Value |
| --- | --- |
| Test date | ${testDate} |
| Tester | QA |
| RemoteShare version/tag | ${version} |
${extraContextRows}| Input direction | ${macSetupEvidence} |
| macOS role shown | ${macSetupEvidence} |
| Windows role shown | ${windowsSetupEvidence} |
| macOS model/version | MacBook / macOS 15 |
| Windows model/version | PC / Windows 11 |
| macOS installer file | ${macInstaller} |
| macOS installer SHA256 | ${macSha256} |
| Windows installer file | ${windowsInstaller} |
| Windows installer SHA256 | ${windowsSha256} |
| Linux installer file | ${linuxInstaller} |
| Linux installer SHA256 | ${linuxSha256} |
| Router/SSID/band | Lab Wi-Fi / 5 GHz |
| Same subnet confirmed | yes |
| macOS firewall status | allowed |
| Windows firewall status | allowed |
| macOS Accessibility permission | enabled |
| macOS Input Monitoring permission | enabled |

## Auto-Discovery Run

| Field | Result |
| --- | --- |
| macOS IP/subnet | 192.168.1.10/24 |
| Windows IP/subnet | 192.168.1.20/24 |
| Peer appeared in \`Scan LAN\` | yes |
| Pair action started | started |
| Same six-digit code shown on both machines | confirmed |
| Six-digit code typed on both machines | confirmed |
| Pairing evidence copied from pending row | Pairing: Outgoing; This computer: Mac sender; Device: Windows receiver; Endpoint: 192.168.1.20:44777; Visible code: 123456; Typed code state: Codes match; Local: approved; Remote: pending; Expires: 86s left |
| \`Trusted\` shown on both machines | shown |
| Full fingerprint copied or visually compared | Trusted Device Audit; This computer: Mac sender; Local fingerprint: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; Peer: Windows receiver; Peer role: Client; Peer fingerprint: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb |
| \`Auto reconnect\` enabled after restart/wake | ${autoReconnectEvidence} |
| Startup health shows TCP ready, UDP ready, and start-at-login not failed | Startup health; This computer: Mac sender; TCP: TCP ready on 0.0.0.0:44777; UDP: UDP ready on 0.0.0.0:44778; Start: start-at-login ok; Reconnect: 3s ago |
| \`Check\` succeeded after restart/wake | ${autoReconnectEvidence} |
| Endpoint source shown | ${autoReconnectEvidence} |
| \`Allow incoming control\` enabled on receiver | Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready |
| Per-device \`Receive\` enabled | Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready |
| Sender \`Test\` delivered accepted \`key press r\` input event | accepted key press r delivered |
| Input Transport source device and relative time shown | Input Transport row shows Mac sender source device and 2 seconds ago |
| Capture started on sender and stopped cleanly | started and stopped cleanly |
| Active capture target and elapsed start time shown | Capture: active; This computer: Mac sender; Target: Windows receiver; Started: 4s ago |
| Captured mouse move, mouse click, scroll, and key events accepted on receiver | accepted mouse move, mouse click, scroll, and key events |
| Failure reason visible before retry | none |
| Pass/fail | ${passValue} |

## Manual Fallback Run

| Field | Result |
| --- | --- |
| Discovery disabled, skipped, or failed | discovery skipped for manual fallback |
| Manual endpoint copied from peer \`This computer\` row | ${localEndpointEvidence} |
| Copied endpoint label shown | ${localEndpointEvidence} |
| Endpoint used | 192.168.1.20:44777 |
| TCP \`44777\` reachable | reachable on TCP 44777 via Test-NetConnection TcpTestSucceeded |
| Pair action started | started |
| Same six-digit code shown on both machines | confirmed |
| Six-digit code typed on both machines | confirmed |
| Pairing evidence copied from pending row | Pairing: Incoming; This computer: Mac sender; Device: Windows receiver; Endpoint: 192.168.1.20:44777; Visible code: 123456; Typed code state: Codes match; Local: approved; Remote: pending; Expires: 84s left |
| \`Trusted\` shown on both machines | shown |
| Full fingerprint copied or visually compared | Trusted Device Audit; This computer: Mac sender; Local fingerprint: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; Peer: Windows receiver; Peer role: Client; Peer fingerprint: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb |
| \`Auto reconnect\` enabled after restart/wake | ${manualReconnectEvidence} |
| Startup health shows TCP ready, UDP ready, and start-at-login not failed | Startup health; This computer: Windows receiver; TCP: TCP ready on 0.0.0.0:44777; UDP: UDP ready on 0.0.0.0:44778; Start: start-at-login ok; Started: 10s ago |
| \`Check\` succeeded after restart/wake | ${manualReconnectEvidence} |
| Endpoint source shown as saved endpoint or manual IP | ${manualReconnectEvidence} |
| \`Allow incoming control\` enabled on receiver | Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready |
| Per-device \`Receive\` enabled | Receive control; This computer: Windows receiver; Role: Client; Allow incoming control: enabled; Device: Mac sender; Device receive: enabled; Input control: ready |
| Sender \`Test\` delivered accepted \`key press r\` input event | accepted key press r delivered |
| Input Transport source device and relative time shown | Input Transport row shows Mac sender source device and 3 seconds ago |
| Capture started on sender and stopped cleanly | started and stopped cleanly |
| Active capture target and elapsed start time shown | Capture: active; This computer: Mac sender; Target: Windows receiver; Started: 5s ago |
| Captured mouse move, mouse click, scroll, and key events accepted on receiver | accepted mouse move, mouse click, scroll, and key events |
| Failure reason visible before retry | none |
| Pass/fail | Pass |

## Notes

- Blocking issues: none
${capturedEvidenceNote}- Retest required: no
`
  );
  return file;
}

function runVerifier(releaseAssets, smokeReport, shouldPass, label, expectedOutput) {
  const result = spawnSync(process.execPath, [verifier, releaseAssets, smokeReport], {
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function futureIsoDate() {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
