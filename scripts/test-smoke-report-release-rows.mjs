import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-smoke-report-rows-"));
const helper = path.resolve("scripts/smoke-report-release-rows.mjs");

try {
  const valid = fixture("valid", [
    ["dmg", "RemoteShare_0.1.8_aarch64.dmg", "valid dmg"],
    ["exe", "RemoteShare_0.1.8_x64-setup.exe", "valid exe"],
    ["deb", "RemoteShare_0.1.8_amd64.deb", "valid deb"]
  ]);
  runHelper(valid, true, "valid release rows should pass", [
    "| RemoteShare version/tag | v0.1.8 |",
    "| macOS installer file | RemoteShare_0.1.8_aarch64.dmg |",
    `| macOS installer SHA256 | ${sha256("valid dmg")} |`,
    "| Windows installer file | RemoteShare_0.1.8_x64-setup.exe |",
    `| Windows installer SHA256 | ${sha256("valid exe")} |`,
    "| Linux installer file | RemoteShare_0.1.8_amd64.deb |",
    `| Linux installer SHA256 | ${sha256("valid deb")} |`
  ]);

  const missingManifest = path.join(root, "missing-manifest");
  fs.mkdirSync(missingManifest, { recursive: true });
  runHelper(missingManifest, false, "missing manifest should fail", ["Missing release manifest"]);

  const missingExe = fixture("missing-exe", [
    ["dmg", "RemoteShare_0.1.8_aarch64.dmg", "valid dmg"],
    ["deb", "RemoteShare_0.1.8_amd64.deb", "valid deb"]
  ]);
  runHelper(missingExe, false, "missing exe should fail", ["missing exe artifact"]);

  const missingDeb = fixture("missing-deb", [
    ["dmg", "RemoteShare_0.1.8_aarch64.dmg", "valid dmg"],
    ["exe", "RemoteShare_0.1.8_x64-setup.exe", "valid exe"]
  ]);
  runHelper(missingDeb, false, "missing deb should fail", ["missing deb artifact"]);

  console.log("Smoke report release row tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files) {
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
    `${JSON.stringify({ artifacts }, null, 2)}\n`
  );
  return directory;
}

function runHelper(directory, shouldPass, label, expectedOutput) {
  const result = spawnSync(process.execPath, [helper, directory], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  for (const expected of expectedOutput) {
    if (!output.includes(expected)) {
      throw new Error(`${label}: expected output to include ${expected}\n${output}`);
    }
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
