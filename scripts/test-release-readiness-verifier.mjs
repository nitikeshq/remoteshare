import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-readiness-"));
const verifier = path.resolve("scripts/verify-release-readiness.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

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
      { version: packageVersion, artifacts: artifacts.sort((a, b) => a.type.localeCompare(b.type)) },
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
  fs.writeFileSync(
    file,
    `# LAN Smoke Report

## Test Context

| Field | Value |
| --- | --- |
| Test date | 2026-06-02 |
| Tester | QA |
| RemoteShare version/tag | ${version} |
| Input direction | macOS sender/main -> Windows receiver/client |
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
| \`Trusted\` shown on both machines | shown |
| Full fingerprint copied or visually compared | Pass - Trusted Device Audit copied full local and peer fingerprints |
| \`Auto reconnect\` enabled after restart/wake | enabled after restart |
| Startup health shows TCP ready, UDP ready, and start-at-login not failed | ready: TCP ready, UDP ready, start-at-login ok |
| \`Check\` succeeded after restart/wake | succeeded after restart |
| Endpoint source shown | discovery |
| \`Allow incoming control\` enabled on receiver | enabled |
| Per-device \`Receive\` enabled | enabled |
| Sender \`Test\` delivered accepted \`key press r\` input event | accepted key press r delivered |
| Input Transport source device and relative time shown | Input Transport row shows Mac sender source device and 2 seconds ago |
| Capture started on sender and stopped cleanly | started and stopped cleanly |
| Active capture target and elapsed start time shown | active target Windows receiver, started 4 seconds ago |
| Captured mouse move, mouse click, scroll, and key events accepted on receiver | accepted mouse move, mouse click, scroll, and key events |
| Failure reason visible before retry | none |
| Pass/fail | ${passValue} |

## Manual Fallback Run

| Field | Result |
| --- | --- |
| Discovery disabled, skipped, or failed | discovery skipped for manual fallback |
| Manual endpoint copied from peer \`This computer\` row | copied from peer This computer row |
| Endpoint used | 192.168.1.20:44777 |
| TCP \`44777\` reachable | reachable |
| Pair action started | started |
| Same six-digit code shown on both machines | confirmed |
| Six-digit code typed on both machines | confirmed |
| \`Trusted\` shown on both machines | shown |
| Full fingerprint copied or visually compared | Pass - Trusted Device Audit copied full local and peer fingerprints |
| \`Auto reconnect\` enabled after restart/wake | enabled after restart |
| Startup health shows TCP ready, UDP ready, and start-at-login not failed | ready: TCP ready, UDP ready, start-at-login ok |
| \`Check\` succeeded after restart/wake | succeeded after restart |
| Endpoint source shown as saved endpoint or manual IP | saved endpoint |
| \`Allow incoming control\` enabled on receiver | enabled |
| Per-device \`Receive\` enabled | enabled |
| Sender \`Test\` delivered accepted \`key press r\` input event | accepted key press r delivered |
| Input Transport source device and relative time shown | Input Transport row shows Mac sender source device and 3 seconds ago |
| Capture started on sender and stopped cleanly | started and stopped cleanly |
| Active capture target and elapsed start time shown | active target Windows receiver, started 5 seconds ago |
| Captured mouse move, mouse click, scroll, and key events accepted on receiver | accepted mouse move, mouse click, scroll, and key events |
| Failure reason visible before retry | none |
| Pass/fail | Pass |
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
