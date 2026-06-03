import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  validateManifestArtifactTypes,
  validateReleaseManifestArtifact
} from "./release-artifacts-lib.mjs";

const releaseAssetsRoot = process.argv[2] ?? "release-assets";
const manifestPath = path.join(releaseAssetsRoot, "RELEASE-MANIFEST.json");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.version !== packageJson.version) {
  throw new Error(
    `Release manifest version must match package version ${packageJson.version}.`
  );
}

if (!Array.isArray(manifest.artifacts)) {
  throw new Error("Release manifest must contain an artifacts array.");
}

validateManifestArtifactTypes(manifest.artifacts);
const manifestArtifacts = manifest.artifacts.map((artifact, index) =>
  validateReleaseManifestArtifact(artifact, index, packageJson.version)
);

const dmg = artifactForType("dmg");
const exe = artifactForType("exe");
const deb = artifactForType("deb");

console.log(`| RemoteShare version/tag | v${packageJson.version} |`);
console.log(`| macOS installer file | ${dmg.file} |`);
console.log(`| macOS installer SHA256 | ${dmg.sha256} |`);
console.log(`| Windows installer file | ${exe.file} |`);
console.log(`| Windows installer SHA256 | ${exe.sha256} |`);
console.log(`| Linux installer file | ${deb.file} |`);
console.log(`| Linux installer SHA256 | ${deb.sha256} |`);

function artifactForType(type) {
  const artifact = manifestArtifacts.find((candidate) => candidate.type === type);
  if (!artifact) {
    throw new Error(`Release manifest is missing ${type} artifact.`);
  }

  const artifactPath = path.join(releaseAssetsRoot, artifact.file);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Release manifest ${type} artifact file is missing: ${artifact.file}`);
  }

  const bytes = fs.readFileSync(artifactPath);
  if (bytes.length !== artifact.sizeBytes) {
    throw new Error(`Release manifest ${type} artifact size mismatch: ${artifact.file}`);
  }

  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== artifact.sha256) {
    throw new Error(`Release manifest ${type} artifact hash mismatch: ${artifact.file}`);
  }

  return artifact;
}
