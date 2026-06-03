import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  publishArtifactStatus,
  validateReleaseGeneratedAt,
  validateReleaseManifestArtifact
} from "./release-artifacts-lib.mjs";

const assetsRoot = process.argv[2] ?? "release-assets";
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const manifestPath = path.join(assetsRoot, "RELEASE-MANIFEST.json");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/verify-assembled-release-assets.mjs [release-assets-dir]");
  process.exit(0);
}

if (!fs.existsSync(assetsRoot) || !fs.statSync(assetsRoot).isDirectory()) {
  throw new Error(`Release assets directory is missing: ${assetsRoot}`);
}

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.version !== packageVersion) {
  throw new Error(
    `Release manifest version must match package version ${packageVersion}; got ${String(manifest.version)}.`
  );
}

if (!Array.isArray(manifest.artifacts)) {
  throw new Error("Release manifest must contain an artifacts array.");
}

validateReleaseGeneratedAt(manifest.generatedAt);
const manifestArtifacts = manifest.artifacts.map((artifact, index) =>
  validateReleaseManifestArtifact(artifact, index, packageVersion)
);
const { duplicateTypes, missingTypes } = publishArtifactStatus(manifestArtifacts);

if (missingTypes.length > 0) {
  throw new Error(`Release manifest missing artifact type(s): ${missingTypes.join(", ")}`);
}

if (duplicateTypes.length > 0) {
  throw new Error(
    `Release manifest must contain exactly one artifact per type; duplicate type(s): ${duplicateTypes.join(", ")}`
  );
}

const expectedFiles = [
  ...manifestArtifacts.map((artifact) => artifact.file),
  "SHA256SUMS.txt",
  "RELEASE-MANIFEST.json",
  "lan-smoke-report.md",
  "release-candidate-summary.md"
].sort();

const actualEntries = fs.readdirSync(assetsRoot, { withFileTypes: true });
const directories = actualEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
if (directories.length > 0) {
  throw new Error(`Release assets directory must be flat; found directories: ${directories.sort().join(", ")}`);
}

const actualFiles = actualEntries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
const missingFiles = expectedFiles.filter((file) => !actualFiles.includes(file));
const unexpectedFiles = actualFiles.filter((file) => !expectedFiles.includes(file));

if (missingFiles.length > 0) {
  throw new Error(`Assembled release assets missing file(s): ${missingFiles.join(", ")}`);
}

if (unexpectedFiles.length > 0) {
  throw new Error(`Assembled release assets contain unexpected file(s): ${unexpectedFiles.join(", ")}`);
}

run(process.execPath, ["scripts/verify-release-manifest.mjs", assetsRoot]);
verifyGeneratedAsset(
  "lan-smoke-report.md",
  "scripts/prepare-lan-smoke-report.mjs",
  "Prefilled LAN smoke report must match assembled release assets."
);
verifyGeneratedAsset(
  "release-candidate-summary.md",
  "scripts/release-candidate-summary.mjs",
  "Release candidate summary must match assembled release assets."
);

console.log(`Verified assembled release assets in ${assetsRoot}.`);

function verifyGeneratedAsset(fileName, script, mismatchMessage) {
  const downloadedPath = path.join(assetsRoot, fileName);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-assembled-assets-"));
  const expectedPath = path.join(tempDirectory, fileName);
  try {
    run(process.execPath, [script, assetsRoot, expectedPath], { echoOutput: false });
    const downloaded = fs.readFileSync(downloadedPath, "utf8");
    const expected = fs.readFileSync(expectedPath, "utf8");
    if (downloaded !== expected) {
      throw new Error(mismatchMessage);
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function run(command, commandArgs, options = {}) {
  const { echoOutput = true } = options;
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`${command} ${commandArgs.join(" ")} failed.\n${output}`);
  }

  if (echoOutput && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (echoOutput && result.stderr) {
    process.stderr.write(result.stderr);
  }
}
