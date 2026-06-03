import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  publishArtifactStatus,
  validateReleaseGeneratedAt,
  validateReleaseManifestArtifact
} from "./release-artifacts-lib.mjs";

const root = process.argv[2] ?? "release-assets";
const manifestPath = path.join(root, "RELEASE-MANIFEST.json");
const checksumPath = path.join(root, "SHA256SUMS.txt");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

if (!fs.existsSync(checksumPath)) {
  throw new Error(`Missing release checksum file: ${checksumPath}`);
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

const checksumEntries = readChecksumFile(checksumPath);
const manifestFiles = new Set(manifestArtifacts.map((artifact) => artifact.file));
const unexpectedArtifacts = findUnexpectedInstallerArtifacts(root);
const extraInstallerArtifacts = findInstallerArtifacts(root).filter(
  (artifact) => !manifestFiles.has(path.basename(artifact.file))
);

if (unexpectedArtifacts.length > 0) {
  throw new Error(
    `Release assets contain unexpected installer artifact(s): ${unexpectedArtifacts
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

if (extraInstallerArtifacts.length > 0) {
  throw new Error(
    `Release assets contain installer artifact(s) not present in manifest: ${extraInstallerArtifacts
      .map((artifact) => path.relative(root, artifact.file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

for (const checksumFile of checksumEntries.keys()) {
  if (!manifestFiles.has(checksumFile)) {
    throw new Error(`Checksum file contains stale entry not present in manifest: ${checksumFile}`);
  }
}

for (const artifact of manifestArtifacts) {
  const expectedChecksum = checksumEntries.get(artifact.file);
  if (!expectedChecksum) {
    throw new Error(`Checksum file is missing manifest entry: ${artifact.file}`);
  }

  if (expectedChecksum !== artifact.sha256) {
    throw new Error(`Checksum mismatch for manifest entry: ${artifact.file}`);
  }

  const file = path.join(root, artifact.file);
  if (!fs.existsSync(file)) {
    throw new Error(`Manifest artifact file is missing: ${artifact.file}`);
  }

  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    throw new Error(`Manifest artifact path is not a file: ${artifact.file}`);
  }

  if (stat.size !== artifact.sizeBytes) {
    throw new Error(`Manifest size mismatch for ${artifact.file}`);
  }

  const actualHash = sha256(fs.readFileSync(file));
  if (actualHash !== artifact.sha256) {
    throw new Error(`Manifest hash mismatch for ${artifact.file}`);
  }
}

console.log(`Verified release manifest for ${manifestArtifacts.length} artifact(s).`);

function readChecksumFile(file) {
  const entries = new Map();
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/);
    if (!match) {
      throw new Error(`Invalid checksum line: ${line}`);
    }

    const [, hash, basename] = match;
    if (path.basename(basename) !== basename) {
      throw new Error(`Checksum entry must use a basename-only file path: ${basename}`);
    }

    if (entries.has(basename)) {
      throw new Error(`Duplicate checksum entry: ${basename}`);
    }

    entries.set(basename, hash);
  }

  return entries;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
