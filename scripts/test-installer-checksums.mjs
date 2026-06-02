import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-installer-checksums-"));
const checksumsScript = path.resolve("scripts/installer-checksums.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

try {
  const validRoot = fixture("valid", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`deb/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runChecksums(validRoot, true, "valid installers should write checksums", "Wrote");
  assertChecksums(validRoot, [
    [`deb/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"],
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]
  ]);

  const missingRoot = fixture("missing", []);
  runChecksums(missingRoot, false, "missing installers should fail", "No installer files found");

  const emptyRoot = fixture("empty", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, ""]
  ]);
  runChecksums(emptyRoot, false, "empty installer should fail", "Empty installer artifact(s)");
  if (fs.existsSync(path.join(emptyRoot, "SHA256SUMS.txt"))) {
    throw new Error("empty installer should not write SHA256SUMS.txt");
  }

  const wrongVersionRoot = fixture("wrong-version", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["nsis/RemoteShare_9.9.9_x64-setup.exe", "wrong exe"]
  ]);
  runChecksums(
    wrongVersionRoot,
    false,
    "wrong version installer should fail",
    `Installer filename(s) must include package version ${packageVersion}`
  );
  if (fs.existsSync(path.join(wrongVersionRoot, "SHA256SUMS.txt"))) {
    throw new Error("wrong version installer should not write SHA256SUMS.txt");
  }

  console.log("Installer checksum generation tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });

  for (const [relativePath, body] of files) {
    const file = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }

  return directory;
}

function runChecksums(directory, shouldPass, label, expectedOutput = "") {
  const result = spawnSync(process.execPath, [checksumsScript, directory], {
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

function assertChecksums(directory, expectedFiles) {
  const actual = fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8").trim();
  const expected = expectedFiles
    .map(([relativePath, body]) => `${sha256(body)}  ${relativePath}`)
    .join("\n");

  if (actual !== expected) {
    throw new Error(`Unexpected checksum output:\n${actual}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
