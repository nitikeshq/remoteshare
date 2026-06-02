import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-installer-verifier-"));
const verifier = path.resolve("scripts/verify-installer-artifacts.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

try {
  const validRoot = fixture("valid-macos", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  runVerifier(validRoot, "macos", true, "valid macOS artifact should pass");
  runVerifier(validRoot, "macOS", true, "GitHub runner macOS value should pass");

  const validWindowsRoot = fixture("valid-windows-runner", [
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]
  ]);
  runVerifier(validWindowsRoot, "Windows", true, "GitHub runner Windows value should pass");

  const validLinuxRoot = fixture("valid-linux-runner", [
    [`deb/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runVerifier(validLinuxRoot, "Linux", true, "GitHub runner Linux value should pass");

  const unexpectedRoot = fixture("unexpected-windows-artifact", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "unexpected exe"]
  ]);
  runVerifier(
    unexpectedRoot,
    "macos",
    false,
    "unexpected installer artifact should fail",
    "Unexpected installer artifact(s)"
  );

  const staleChecksumRoot = fixture("stale-checksum", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.appendFileSync(
    path.join(staleChecksumRoot, "SHA256SUMS.txt"),
    `${"0".repeat(64)}  nsis/stale.exe\n`
  );
  runVerifier(
    staleChecksumRoot,
    "macos",
    false,
    "stale checksum entry should fail",
    "Checksum file contains unexpected"
  );

  const duplicateChecksumRoot = fixture("duplicate-checksum", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  const duplicateHash = sha256("different dmg body");
  fs.appendFileSync(
    path.join(duplicateChecksumRoot, "SHA256SUMS.txt"),
    `${duplicateHash}  dmg/RemoteShare_${packageVersion}_aarch64.dmg\n`
  );
  runVerifier(
    duplicateChecksumRoot,
    "macos",
    false,
    "duplicate checksum entry should fail",
    "Duplicate checksum entry"
  );

  const missingChecksumRoot = fixture("missing-checksum", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.rmSync(path.join(missingChecksumRoot, "SHA256SUMS.txt"));
  runVerifier(
    missingChecksumRoot,
    "macos",
    false,
    "missing checksum file should fail",
    "Missing checksum file"
  );

  const mismatchRoot = fixture("checksum-mismatch", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.writeFileSync(path.join(mismatchRoot, `dmg/RemoteShare_${packageVersion}_aarch64.dmg`), "changed dmg");
  runVerifier(
    mismatchRoot,
    "macos",
    false,
    "checksum mismatch should fail",
    "Checksum mismatch"
  );

  const emptyRoot = fixture("empty-installer", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, ""]
  ]);
  runVerifier(
    emptyRoot,
    "macos",
    false,
    "empty installer artifact should fail",
    "Empty installer artifact(s)"
  );

  const wrongVersionRoot = fixture("wrong-version-installer", [
    ["dmg/RemoteShare_9.9.9_aarch64.dmg", "wrong version dmg"]
  ]);
  runVerifier(
    wrongVersionRoot,
    "macos",
    false,
    "wrong version installer artifact should fail",
    `must include package version ${packageVersion}`
  );

  console.log("Installer verifier tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });

  const checksumLines = [];
  for (const [relativePath, body] of files) {
    const file = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    checksumLines.push(`${sha256(body)}  ${relativePath.replaceAll(path.sep, "/")}`);
  }

  fs.writeFileSync(path.join(directory, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);
  return directory;
}

function runVerifier(directory, platform, shouldPass, label, expectedOutput = "") {
  const result = spawnSync(process.execPath, [verifier, directory, platform], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  if (expectedOutput && !output.includes(expectedOutput)) {
    throw new Error(`${label}: expected output to include ${expectedOutput}\n${output}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
