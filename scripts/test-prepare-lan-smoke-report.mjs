import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-prepare-lan-smoke-"));
const preparer = path.resolve("scripts/prepare-lan-smoke-report.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

try {
  const assets = fixture("release-assets", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  const output = path.join(root, "reports/lan-smoke.md");
  runPreparer(assets, output, true, "valid report should be prepared", "Prepared LAN smoke report");
  assertReport(output, [
    `| RemoteShare version/tag | v${packageVersion} |`,
    "| Input direction | macOS sender/main -> Windows receiver/client |",
    `| macOS installer file | RemoteShare_${packageVersion}_aarch64.dmg |`,
    `| macOS installer SHA256 | ${sha256("valid dmg")} |`,
    `| Windows installer file | RemoteShare_${packageVersion}_x64-setup.exe |`,
    `| Windows installer SHA256 | ${sha256("valid exe")} |`,
    `| Linux installer file | RemoteShare_${packageVersion}_amd64.deb |`,
    `| Linux installer SHA256 | ${sha256("valid deb")} |`,
    "| Startup health shows TCP ready, UDP ready, and start-at-login not failed |  |",
    "| Capture started on sender and stopped cleanly |  |",
    "| Captured mouse move, mouse click, scroll, and key events accepted on receiver |  |"
  ]);

  runPreparer(assets, output, false, "existing report should fail", "already exists");

  const missingManifest = path.join(root, "missing-manifest");
  fs.mkdirSync(missingManifest, { recursive: true });
  runPreparer(
    missingManifest,
    path.join(root, "missing.md"),
    false,
    "missing manifest should fail",
    "Missing release manifest"
  );

  const missingExe = fixture("missing-exe", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runPreparer(
    missingExe,
    path.join(root, "missing-exe.md"),
    false,
    "missing exe should fail",
    "missing exe artifact"
  );

  const missingDeb = fixture("missing-deb", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]
  ]);
  runPreparer(
    missingDeb,
    path.join(root, "missing-deb.md"),
    false,
    "missing deb should fail",
    "missing deb artifact"
  );

  const wrongManifestVersion = fixture("wrong-manifest-version", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ], "9.9.9");
  runPreparer(
    wrongManifestVersion,
    path.join(root, "wrong-manifest-version.md"),
    false,
    "wrong manifest version should fail",
    `Release manifest version must match package version ${packageVersion}`
  );

  const wrongArtifactVersion = fixture("wrong-artifact-version", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", "RemoteShare_9.9.9_amd64.deb", "valid deb"]
  ]);
  runPreparer(
    wrongArtifactVersion,
    path.join(root, "wrong-artifact-version.md"),
    false,
    "wrong artifact version should fail",
    `Release manifest deb artifact filename must include package version ${packageVersion}`
  );

  console.log("LAN smoke report preparation tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files, version = packageVersion) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const artifacts = files.map(([type, file, body]) => ({
    file,
    sha256: sha256(body),
    sizeBytes: Buffer.byteLength(body),
    type
  }));
  fs.writeFileSync(
    path.join(directory, "RELEASE-MANIFEST.json"),
    `${JSON.stringify({ version, artifacts }, null, 2)}\n`
  );
  return directory;
}

function runPreparer(assets, output, shouldPass, label, expectedOutput) {
  const result = spawnSync(process.execPath, [preparer, assets, output], {
    encoding: "utf8"
  });
  const commandOutput = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${commandOutput}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${commandOutput}`);
  }

  if (!commandOutput.includes(expectedOutput)) {
    throw new Error(`${label}: expected output to include ${expectedOutput}\n${commandOutput}`);
  }
}

function assertReport(file, expectedRows) {
  const report = fs.readFileSync(file, "utf8");
  for (const row of expectedRows) {
    if (!report.includes(row)) {
      throw new Error(`Prepared report missing row: ${row}`);
    }
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
