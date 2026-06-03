import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  publishArtifactStatus,
  requiredArtifactTypes
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

const manifestArtifacts = manifest.artifacts.map(validateManifestArtifact);
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

function validateManifestArtifact(artifact, index) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`Manifest artifact ${index} must be an object.`);
  }

  const { file, sha256, sizeBytes, type } = artifact;
  if (typeof type !== "string" || !requiredArtifactTypes.has(type)) {
    throw new Error(`Manifest artifact ${index} has invalid type: ${String(type)}`);
  }

  if (typeof file !== "string" || file.length === 0 || path.basename(file) !== file) {
    throw new Error(`Manifest artifact ${index} must use a basename-only file path.`);
  }

  const expectedExtension = requiredArtifactTypes.get(type);
  if (path.extname(file).toLowerCase() !== expectedExtension) {
    throw new Error(
      `Manifest artifact ${file} must use ${expectedExtension} extension for ${type}.`
    );
  }

  if (!file.includes(`_${packageVersion}_`)) {
    throw new Error(
      `Manifest artifact ${file} must include package version ${packageVersion}.`
    );
  }

  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`Manifest artifact ${file} has invalid sha256.`);
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Manifest artifact ${file} has invalid sizeBytes.`);
  }

  return { file, sha256, sizeBytes, type };
}

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
