import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-smoke-report-rows-"));
const helper = path.resolve("scripts/smoke-report-release-rows.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = "2026-06-01T10:00:00.000Z";

try {
  const valid = fixture("valid", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runHelper(valid, true, "valid release rows should pass", [
    `| RemoteShare version/tag | v${packageVersion} |`,
    `| macOS installer file | RemoteShare_${packageVersion}_aarch64.dmg |`,
    `| macOS installer SHA256 | ${sha256("valid dmg")} |`,
    `| Windows installer file | RemoteShare_${packageVersion}_x64-setup.exe |`,
    `| Windows installer SHA256 | ${sha256("valid exe")} |`,
    `| Linux installer file | RemoteShare_${packageVersion}_amd64.deb |`,
    `| Linux installer SHA256 | ${sha256("valid deb")} |`
  ]);

  const missingManifest = path.join(root, "missing-manifest");
  fs.mkdirSync(missingManifest, { recursive: true });
  runHelper(missingManifest, false, "missing manifest should fail", ["Missing release manifest"]);

  const invalidManifest = path.join(root, "invalid-manifest");
  fs.mkdirSync(invalidManifest, { recursive: true });
  fs.writeFileSync(path.join(invalidManifest, "RELEASE-MANIFEST.json"), "{not json");
  runHelper(invalidManifest, false, "invalid manifest JSON should fail", [
    "Invalid release manifest JSON"
  ]);

  const missingExe = fixture("missing-exe", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runHelper(missingExe, false, "missing exe should fail", ["missing exe artifact"]);

  const missingDeb = fixture("missing-deb", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]
  ]);
  runHelper(missingDeb, false, "missing deb should fail", ["missing deb artifact"]);

  const duplicateDmg = fixture("duplicate-dmg", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["dmg", `RemoteShare_${packageVersion}_duplicate.dmg`, "duplicate dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runHelper(duplicateDmg, false, "duplicate manifest type should fail", [
    "Release manifest contains duplicate artifact type: dmg"
  ]);

  const unexpectedMsi = fixture("unexpected-msi", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"],
    ["msi", `RemoteShare_${packageVersion}_x64.msi`, "unexpected msi"]
  ]);
  runHelper(unexpectedMsi, false, "unexpected manifest type should fail", [
    "Release manifest contains unexpected artifact type: msi"
  ]);

  const wrongManifestVersion = fixture(
    "wrong-manifest-version",
    [
      ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
    ],
    "9.9.9"
  );
  runHelper(wrongManifestVersion, false, "wrong manifest version should fail", [
    `Release manifest version must match package version ${packageVersion}`
  ]);

  const futureGeneratedAt = fixture(
    "future-generated-at",
    [
      ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
    ],
    packageVersion,
    "2999-01-01T00:00:00.000Z"
  );
  runHelper(futureGeneratedAt, false, "future generatedAt should fail", [
    "Release manifest generatedAt cannot be in the future"
  ]);

  const missingFile = fixture("missing-file", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe", { writeFile: false }],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runHelper(missingFile, false, "missing artifact file should fail", [
    `Release manifest exe artifact file is missing: RemoteShare_${packageVersion}_x64-setup.exe`
  ]);

  const hashMismatch = fixture("hash-mismatch", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe", { sha256: "0".repeat(64) }],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runHelper(hashMismatch, false, "artifact hash mismatch should fail", [
    `Release manifest exe artifact hash mismatch: RemoteShare_${packageVersion}_x64-setup.exe`
  ]);

  console.log("Smoke report release row tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files, version = packageVersion, manifestGeneratedAt = generatedAt) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const artifacts = files.map(([type, file, body, options = {}]) => {
    if (options.writeFile !== false) {
      fs.writeFileSync(path.join(directory, file), body);
    }
    return {
      file,
      sha256: options.sha256 ?? sha256(body),
      sizeBytes: options.sizeBytes ?? Buffer.byteLength(body),
      type
    };
  });
  fs.writeFileSync(
    path.join(directory, "RELEASE-MANIFEST.json"),
    `${JSON.stringify({ version, generatedAt: manifestGeneratedAt, artifacts }, null, 2)}\n`
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
