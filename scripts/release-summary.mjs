import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  requiredArtifactTypes
} from "./release-artifacts-lib.mjs";

const root = process.argv[2] ?? "src-tauri/target/release/bundle";
const checksumPath = path.join(root, "SHA256SUMS.txt");
const manifestPath = path.join(root, "RELEASE-MANIFEST.json");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const invalidChecksumLines = [];
const duplicateChecksumEntries = [];
const platformArtifacts = [
  { name: "macOS DMG", extension: ".dmg", nativeRunner: "macOS" },
  { name: "Windows EXE", extension: ".exe", nativeRunner: "Windows" },
  { name: "Linux DEB", extension: ".deb", nativeRunner: "Ubuntu/Linux" }
];
const installerArtifacts = findInstallerArtifacts(root);
const installers = installerArtifacts.map((artifact) => artifact.file);
const unexpectedArtifacts = findUnexpectedInstallerArtifacts(root);
const checksums = fs.existsSync(checksumPath) ? readChecksumFile(checksumPath) : new Map();
const manifestFiles = readManifestFiles(manifestPath);
const installerRelativePaths = installers.map((file) =>
  path.relative(root, file).replaceAll(path.sep, "/")
);
const unexpectedRelativePaths = unexpectedArtifacts.map((file) =>
  path.relative(root, file).replaceAll(path.sep, "/")
);
const unmanifestedInstallerPaths =
  manifestFiles instanceof Set
    ? installerRelativePaths.filter((relativePath) => !manifestFiles.has(path.basename(relativePath)))
    : [];
const staleChecksumEntries = [...checksums.keys()].filter(
  (relativePath) => !installerRelativePaths.includes(relativePath)
);

console.log(`Bundle root: ${root}`);

if (installers.length === 0) {
  console.log("Installer artifacts: none found");
} else {
  console.log("Installer artifacts:");
  for (const file of installers) {
    const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
    const size = fs.statSync(file).size;
    const checksumState = checksumStatus(file, relativePath);
    const states = [
      formatBytes(size),
      size === 0 ? "empty artifact" : "non-empty",
      checksumState,
      packageVersionMatches(file) ? "version ok" : `version mismatch: expected ${packageVersion}`
    ];
    console.log(`- ${relativePath} (${states.join(", ")})`);
  }
}

if (unexpectedRelativePaths.length > 0) {
  console.log(`Unexpected installer artifacts: ${unexpectedRelativePaths.join(", ")}`);
}

if (unmanifestedInstallerPaths.length > 0) {
  console.log(`Unmanifested installer artifacts: ${unmanifestedInstallerPaths.join(", ")}`);
}

console.log("Platform coverage:");
const missingPlatforms = [];
const duplicatePlatforms = [];
const emptyPlatforms = [];
const checksumMissingPlatforms = [];
const checksumMismatchPlatforms = [];
const versionMismatchPlatforms = [];

for (const artifact of platformArtifacts) {
  const files = installers.filter((file) => path.extname(file).toLowerCase() === artifact.extension);
  if (files.length > 0) {
    const emptyCount = files.filter((file) => fs.statSync(file).size === 0).length;
    const checksumMissingCount = files.filter((file) => {
      const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
      return !checksums.has(relativePath);
    }).length;
    const checksumMismatchCount = files.filter((file) => {
      const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
      const expected = checksums.get(relativePath);
      return Boolean(expected) && sha256File(file) !== expected;
    }).length;
    const versionMismatchCount = files.filter((file) => !packageVersionMatches(file)).length;
    const emptyNote = emptyCount > 0 ? `; ${emptyCount} empty` : "";
    const checksumNote = checksumMissingCount > 0 ? `; ${checksumMissingCount} checksum missing` : "";
    const checksumMismatchNote =
      checksumMismatchCount > 0 ? `; ${checksumMismatchCount} checksum mismatch` : "";
    const versionNote = versionMismatchCount > 0 ? `; ${versionMismatchCount} version mismatch` : "";
    if (files.length > 1) duplicatePlatforms.push(`${artifact.name} has ${files.length} artifacts`);
    if (emptyCount > 0) emptyPlatforms.push(artifact.name);
    if (checksumMissingCount > 0) checksumMissingPlatforms.push(artifact.name);
    if (checksumMismatchCount > 0) checksumMismatchPlatforms.push(artifact.name);
    if (versionMismatchCount > 0) versionMismatchPlatforms.push(artifact.name);
    console.log(
      `- ${artifact.name}: present (${files.length}${emptyNote}${checksumNote}${checksumMismatchNote}${versionNote})`
    );
  } else {
    missingPlatforms.push(artifact.name);
    console.log(`- ${artifact.name}: missing; build on ${artifact.nativeRunner} runner`);
  }
}

const readinessIssues = [
  ...missingPlatforms.map((name) => `${name} missing`),
  ...duplicatePlatforms,
  ...emptyPlatforms.map((name) => `${name} empty`),
  ...checksumMissingPlatforms.map((name) => `${name} checksum missing`),
  ...checksumMismatchPlatforms.map((name) => `${name} checksum mismatch`),
  ...versionMismatchPlatforms.map((name) => `${name} version mismatch`),
  ...unexpectedRelativePaths.map((entry) => `unexpected installer ${entry}`),
  ...unmanifestedInstallerPaths.map((entry) => `unmanifested installer ${entry}`),
  ...staleChecksumEntries.map((entry) => `stale checksum ${entry}`),
  ...invalidChecksumLines.map((line) => `invalid checksum line ${line}`),
  ...duplicateChecksumEntries.map((entry) => `duplicate checksum ${entry}`)
];
console.log(
  readinessIssues.length === 0
    ? "Publish readiness: exactly one installer per platform is present, non-empty, checksummed, and version-matched."
    : `Publish readiness: incomplete (${readinessIssues.join("; ")}).`
);

if (fs.existsSync(checksumPath)) {
  console.log(`Checksum file: ${checksumPath}`);
  if (staleChecksumEntries.length > 0) {
    console.log(`Stale checksum entries: ${staleChecksumEntries.join(", ")}`);
  }
  if (invalidChecksumLines.length > 0) {
    console.log(`Invalid checksum lines: ${invalidChecksumLines.join(" | ")}`);
  }
  if (duplicateChecksumEntries.length > 0) {
    console.log(`Duplicate checksum entries: ${duplicateChecksumEntries.join(", ")}`);
  }
} else {
  console.log("Checksum file: missing");
}

function readChecksumFile(file) {
  const checksums = new Map();
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/);
    if (!match) {
      invalidChecksumLines.push(line);
      continue;
    }
    if (checksums.has(match[2])) {
      duplicateChecksumEntries.push(match[2]);
      continue;
    }
    checksums.set(match[2], match[1]);
  }

  return checksums;
}

function readManifestFiles(file) {
  if (!fs.existsSync(file)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(manifest.artifacts)) return null;

    return new Set(
      manifest.artifacts
        .filter(
          (artifact) =>
            artifact &&
            typeof artifact.file === "string" &&
            typeof artifact.type === "string" &&
            requiredArtifactTypes.has(artifact.type)
        )
        .map((artifact) => artifact.file)
    );
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function packageVersionMatches(file) {
  return path.basename(file).includes(`_${packageVersion}_`);
}

function checksumStatus(file, relativePath) {
  const expected = checksums.get(relativePath);
  if (!expected) return "checksum missing";
  return sha256File(file) === expected ? "checksum ok" : "checksum mismatch";
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
