import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  validateManifestArtifactTypes,
  validateReleaseGeneratedAt,
  validateReleaseManifestArtifact
} from "./release-artifacts-lib.mjs";

const root = process.argv[2] ?? "src-tauri/target/release/bundle";
const checksumPath = path.join(root, "SHA256SUMS.txt");
const manifestPath = path.join(root, "RELEASE-MANIFEST.json");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAssets = [
  {
    label: "Prefilled LAN smoke report",
    file: "lan-smoke-report.md",
    script: "scripts/prepare-lan-smoke-report.mjs"
  },
  {
    label: "Release candidate summary",
    file: "release-candidate-summary.md",
    script: "scripts/release-candidate-summary.mjs"
  }
];
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
const manifestExists = fs.existsSync(manifestPath);
const manifestStatus = readManifestStatus(manifestPath);
const manifestFiles = manifestStatus.files;
const manifestIssue = !manifestExists
  ? "release manifest missing"
  : manifestFiles instanceof Set
    ? null
    : "release manifest invalid";
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

const canCheckGeneratedAssets =
  manifestFiles instanceof Set &&
  missingPlatforms.length === 0 &&
  duplicatePlatforms.length === 0 &&
  emptyPlatforms.length === 0 &&
  checksumMissingPlatforms.length === 0 &&
  checksumMismatchPlatforms.length === 0 &&
  versionMismatchPlatforms.length === 0 &&
  unexpectedRelativePaths.length === 0 &&
  unmanifestedInstallerPaths.length === 0 &&
  staleChecksumEntries.length === 0 &&
  invalidChecksumLines.length === 0 &&
  duplicateChecksumEntries.length === 0;
const generatedAssetStatuses = generatedAssets.map((asset) =>
  generatedAssetStatus(asset, canCheckGeneratedAssets)
);

console.log("Generated release evidence:");
for (const status of generatedAssetStatuses) {
  console.log(`- ${status.label}: ${status.state}${status.detail ? ` (${status.detail})` : ""}`);
}

const readinessIssues = [
  ...missingPlatforms.map((name) => `${name} missing`),
  ...duplicatePlatforms,
  ...emptyPlatforms.map((name) => `${name} empty`),
  ...checksumMissingPlatforms.map((name) => `${name} checksum missing`),
  ...checksumMismatchPlatforms.map((name) => `${name} checksum mismatch`),
  ...versionMismatchPlatforms.map((name) => `${name} version mismatch`),
  ...(manifestIssue ? [manifestIssue] : []),
  ...unexpectedRelativePaths.map((entry) => `unexpected installer ${entry}`),
  ...unmanifestedInstallerPaths.map((entry) => `unmanifested installer ${entry}`),
  ...staleChecksumEntries.map((entry) => `stale checksum ${entry}`),
  ...invalidChecksumLines.map((line) => `invalid checksum line ${line}`),
  ...duplicateChecksumEntries.map((entry) => `duplicate checksum ${entry}`),
  ...generatedAssetStatuses.flatMap((status) => status.issue ? [status.issue] : [])
];
console.log(
  readinessIssues.length === 0
    ? "Publish readiness: exactly one installer per platform is present, non-empty, checksummed, version-matched, release-manifest verified, and generated release evidence is current."
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

if (!manifestExists) {
  console.log("Release manifest: missing");
} else if (!(manifestFiles instanceof Set)) {
  console.log("Release manifest: invalid");
  if (manifestStatus.issue) {
    console.log(`Release manifest issue: ${manifestStatus.issue}`);
  }
} else {
  console.log(`Release manifest: ${manifestPath}`);
  console.log(`Release manifest generatedAt: ${manifestStatus.generatedAt}`);
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

function generatedAssetStatus(asset, canCheckFreshness) {
  const assetPath = path.join(root, asset.file);
  if (!fs.existsSync(assetPath)) {
    return {
      label: asset.label,
      state: canCheckFreshness ? "missing" : "missing; skipped freshness check",
      detail: asset.file,
      issue: canCheckFreshness ? `${asset.file} missing` : null
    };
  }

  if (!canCheckFreshness) {
    return {
      label: asset.label,
      state: "present; skipped freshness check",
      detail: asset.file,
      issue: null
    };
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-summary-"));
  const expectedPath = path.join(tempDirectory, asset.file);
  try {
    const result = spawnSync(process.execPath, [asset.script, root, expectedPath], {
      encoding: "utf8"
    });
    if (result.status !== 0) {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      return {
        label: asset.label,
        state: "invalid",
        detail: output || "generation failed",
        issue: `${asset.file} invalid`
      };
    }

    const actual = fs.readFileSync(assetPath, "utf8");
    const expected = fs.readFileSync(expectedPath, "utf8");
    if (actual !== expected) {
      return {
        label: asset.label,
        state: "stale",
        detail: asset.file,
        issue: `${asset.file} stale`
      };
    }

    return {
      label: asset.label,
      state: "current",
      detail: asset.file,
      issue: null
    };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function readManifestStatus(file) {
  if (!fs.existsSync(file)) {
    return { files: null, issue: "missing" };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { files: null, issue: `invalid JSON: ${error.message}` };
    }
    return { files: null, issue: `manifest read failed: ${error.message}` };
  }

  try {
    if (manifest.version !== packageVersion) {
      return {
        files: null,
        issue: `version mismatch: expected ${packageVersion}, got ${String(manifest.version)}`
      };
    }
    try {
      validateReleaseGeneratedAt(manifest.generatedAt);
    } catch (error) {
      return { files: null, issue: error.message };
    }
    if (!Array.isArray(manifest.artifacts)) {
      return { files: null, issue: "artifacts must be an array" };
    }
    try {
      validateManifestArtifactTypes(manifest.artifacts);
    } catch (error) {
      return { files: null, issue: error.message };
    }
    let artifacts;
    try {
      artifacts = manifest.artifacts.map((artifact, index) =>
        validateReleaseManifestArtifact(artifact, index, packageVersion)
      );
    } catch (error) {
      return { files: null, issue: error.message };
    }
    for (const artifact of artifacts) {
      const matches = installers.filter((file) => path.basename(file) === artifact.file);
      if (matches.length !== 1) {
        return {
          files: null,
          issue: `artifact ${artifact.file} must match exactly one installer, found ${matches.length}`
        };
      }
      const artifactPath = matches[0];
      const bytes = fs.readFileSync(artifactPath);
      if (bytes.length !== artifact.sizeBytes) {
        return {
          files: null,
          issue: `artifact ${artifact.file} size mismatch: expected ${artifact.sizeBytes}, got ${bytes.length}`
        };
      }
      const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== artifact.sha256) {
        return {
          files: null,
          issue: `artifact ${artifact.file} hash mismatch: expected ${artifact.sha256}, got ${actualHash}`
        };
      }
    }

    return {
      files: new Set(artifacts.map((artifact) => artifact.file)),
      generatedAt: manifest.generatedAt,
      issue: null
    };
  } catch (error) {
    return { files: null, issue: error.message };
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
