import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  publishArtifactStatus,
  validateReleaseGeneratedAt,
  validateReleaseManifestArtifact
} from "./release-artifacts-lib.mjs";

const releaseJsonPath = process.argv[2];
const releaseAssetsRoot = process.argv[3] ?? "release-assets";
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

if (!releaseJsonPath) {
  throw new Error(
    "Usage: node scripts/verify-github-release-assets.mjs <github-release.json> [release-assets-dir]"
  );
}

if (!fs.existsSync(releaseJsonPath)) {
  throw new Error(`Missing GitHub release JSON: ${releaseJsonPath}`);
}

const release = JSON.parse(fs.readFileSync(releaseJsonPath, "utf8"));
const manifestPath = path.join(releaseAssetsRoot, "RELEASE-MANIFEST.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.version !== packageVersion) {
  throw new Error(
    `Release manifest version must match package version ${packageVersion}; got ${String(manifest.version)}.`
  );
}

if (release.tagName !== `v${packageVersion}`) {
  throw new Error(
    `GitHub release tag must be v${packageVersion}; got ${String(release.tagName || "<missing>")}.`
  );
}

if (release.isDraft !== true) {
  throw new Error("GitHub release must stay draft until LAN smoke testing passes.");
}

if (!Array.isArray(release.assets)) {
  throw new Error("GitHub release JSON must contain an assets array.");
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

const assetsByName = new Map();
for (const asset of release.assets) {
  if (!asset || typeof asset !== "object" || typeof asset.name !== "string") {
    throw new Error("GitHub release asset entries must include a name.");
  }

  if (assetsByName.has(asset.name)) {
    throw new Error(`Duplicate GitHub release asset: ${asset.name}`);
  }

  assetsByName.set(asset.name, asset);
}

const actualFiles = [...assetsByName.keys()].sort();
const missingFiles = expectedFiles.filter((file) => !assetsByName.has(file));
const unexpectedFiles = actualFiles.filter((file) => !expectedFiles.includes(file));

if (missingFiles.length > 0) {
  throw new Error(`GitHub release missing asset(s): ${missingFiles.join(", ")}`);
}

if (unexpectedFiles.length > 0) {
  throw new Error(`GitHub release has unexpected asset(s): ${unexpectedFiles.join(", ")}`);
}

for (const artifact of manifestArtifacts) {
  const localPath = path.join(releaseAssetsRoot, artifact.file);
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local release artifact is missing: ${localPath}`);
  }

  const bytes = fs.readFileSync(localPath);
  if (bytes.byteLength !== artifact.sizeBytes) {
    throw new Error(
      `Release manifest size mismatch for ${artifact.file}: expected ${artifact.sizeBytes}, got ${bytes.byteLength}.`
    );
  }

  const digest = sha256(bytes);
  if (digest !== artifact.sha256) {
    throw new Error(
      `Release manifest hash mismatch for ${artifact.file}: expected ${artifact.sha256}, got ${digest}.`
    );
  }
}

for (const file of expectedFiles) {
  const asset = assetsByName.get(file);
  const localPath = path.join(releaseAssetsRoot, file);
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local release asset is missing: ${localPath}`);
  }

  const localBytes = fs.readFileSync(localPath);
  const localSize = localBytes.byteLength;
  const localDigest = `sha256:${sha256(localBytes)}`;

  if (!Number.isInteger(asset.size) || asset.size <= 0) {
    throw new Error(`GitHub release asset size is invalid: ${file}`);
  }

  if (asset.size !== localSize) {
    throw new Error(
      `GitHub release asset size mismatch for ${file}: expected ${localSize}, got ${asset.size}.`
    );
  }

  if (asset.digest && asset.digest !== localDigest) {
    throw new Error(
      `GitHub release asset digest mismatch for ${file}: expected ${localDigest}, got ${asset.digest}.`
    );
  }
}

console.log(`Verified ${expectedFiles.length} GitHub release asset(s) for v${packageVersion}.`);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
