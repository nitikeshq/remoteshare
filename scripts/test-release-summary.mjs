import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-summary-"));
const summary = path.resolve("scripts/release-summary.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

try {
  const validRoot = fixture("valid", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  runSummary(validRoot, [
    "Installer artifacts:",
    `dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    "non-empty",
    "checksum ok",
    "version ok",
    "Platform coverage:",
    "macOS DMG: present (1)",
    "Windows EXE: missing; build on Windows runner",
    "Linux DEB: missing; build on Ubuntu/Linux runner",
    "Publish readiness: incomplete (Windows EXE missing; Linux DEB missing).",
    "Checksum file:"
  ]);

  const missingChecksumRoot = fixture(
    "missing-checksum",
    [[`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]],
    false
  );
  runSummary(missingChecksumRoot, [
    `nsis/RemoteShare_${packageVersion}_x64-setup.exe`,
    "checksum missing",
    "Windows EXE: present (1; 1 checksum missing)",
    "Publish readiness: incomplete (macOS DMG missing; Linux DEB missing; Windows EXE checksum missing).",
    "Checksum file: missing"
  ]);

  const emptyInstallerRoot = fixture("empty-installer", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, ""]
  ]);
  runSummary(emptyInstallerRoot, [
    `dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    "0 B",
    "empty artifact",
    "macOS DMG: present (1; 1 empty)",
    "Publish readiness: incomplete (Windows EXE missing; Linux DEB missing; macOS DMG empty)."
  ]);

  const staleChecksumRoot = fixture("stale-checksum", [
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  fs.appendFileSync(
    path.join(staleChecksumRoot, "SHA256SUMS.txt"),
    `${"0".repeat(64)}  dmg/stale.dmg\n`
  );
  runSummary(staleChecksumRoot, ["Stale checksum entries: dmg/stale.dmg"]);

  const checksumMismatchRoot = fixture("checksum-mismatch", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.writeFileSync(
    path.join(checksumMismatchRoot, `dmg/RemoteShare_${packageVersion}_aarch64.dmg`),
    "changed dmg"
  );
  runSummary(checksumMismatchRoot, [
    `dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    "checksum mismatch",
    "macOS DMG: present (1; 1 checksum mismatch)",
    "Publish readiness: incomplete (Windows EXE missing; Linux DEB missing; macOS DMG checksum mismatch)."
  ]);

  const completeRoot = fixture("complete", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.DMG`, "valid dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runSummary(completeRoot, [
    `dmg/RemoteShare_${packageVersion}_aarch64.DMG`,
    "macOS DMG: present (1)",
    "Windows EXE: present (1)",
    "Linux DEB: present (1)",
    "Publish readiness: exactly one installer per platform is present, non-empty, checksummed, and version-matched."
  ]);

  const duplicateRoot = fixture("duplicate", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`dmg/RemoteShare_${packageVersion}_x64.dmg`, "valid dmg 2"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runSummary(duplicateRoot, [
    "macOS DMG: present (2)",
    "Publish readiness: incomplete (macOS DMG has 2 artifacts)."
  ]);

  const wrongVersionRoot = fixture("wrong-version", [
    ["dmg/RemoteShare_9.9.9_aarch64.dmg", "wrong dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runSummary(wrongVersionRoot, [
    `version mismatch: expected ${packageVersion}`,
    "macOS DMG: present (1; 1 version mismatch)",
    "Publish readiness: incomplete (macOS DMG version mismatch)."
  ]);

  const emptyRoot = path.join(root, "empty");
  fs.mkdirSync(emptyRoot);
  runSummary(emptyRoot, [
    "Installer artifacts: none found",
    "macOS DMG: missing; build on macOS runner",
    "Windows EXE: missing; build on Windows runner",
    "Linux DEB: missing; build on Ubuntu/Linux runner",
    "Publish readiness: incomplete (macOS DMG missing; Windows EXE missing; Linux DEB missing).",
    "Checksum file: missing"
  ]);

  console.log("Release summary tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files, writeChecksums = true) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });

  const checksumLines = [];
  for (const [relativePath, body] of files) {
    const file = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    checksumLines.push(`${sha256(body)}  ${relativePath.replaceAll(path.sep, "/")}`);
  }

  if (writeChecksums) {
    fs.writeFileSync(path.join(directory, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);
  }

  return directory;
}

function runSummary(directory, expectedOutput) {
  const result = spawnSync(process.execPath, [summary, directory], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.status !== 0) {
    throw new Error(`release summary expected success, got exit ${result.status}\n${output}`);
  }

  for (const expected of expectedOutput) {
    if (!output.includes(expected)) {
      throw new Error(`release summary expected output to include ${expected}\n${output}`);
    }
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
