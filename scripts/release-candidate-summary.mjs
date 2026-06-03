import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  publishArtifactStatus,
  requiredArtifactTypes
} from "./release-artifacts-lib.mjs";

const releaseAssetsRoot = process.argv[2] ?? "release-assets";
const outputPath = process.argv[3] ?? path.join(releaseAssetsRoot, "release-candidate-summary.md");
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

const artifacts = [...requiredArtifactTypes.keys()].map((type) => artifactForType(type));
const rows = artifacts
  .map((artifact) => `| ${artifact.type} | ${artifact.file} | ${artifact.sha256} | ${artifact.sizeBytes} |`)
  .join("\n");

const summary = `# RemoteShare Release Candidate

Version: v${packageJson.version}

## Installer Assets

| Type | File | SHA-256 | Size bytes |
| --- | --- | --- | --- |
${rows}

## Smoke Test Path

1. Install the macOS DMG on the Mac sender/main computer.
2. Install the Windows EXE on the Windows receiver/client.
3. Complete \`lan-smoke-report.md\` for both auto-discovery and manual fallback runs.
4. Use the Trusted Device Audit view to copy or visually compare the local and peer full fingerprints on both machines.
5. Record startup health TCP, UDP, and Start detail strings after restart.
6. Record accepted \`key press r\` test input plus the Input Transport source device and relative time shown on the Windows receiver.
7. Record active capture target and elapsed start time before pressing Stop.
8. Record capture start/stop evidence with accepted mouse move, mouse click, scroll, and key events on the Windows receiver.
9. Verify the completed report:

\`\`\`bash
npm run verify:lan-smoke-report -- path/to/completed-lan-smoke-report.md
npm run verify:release-readiness -- ${releaseAssetsRoot} path/to/completed-lan-smoke-report.md
\`\`\`

Linux DEB is included for package coverage evidence, but the first MVP smoke path is Mac-to-Windows.
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, summary);
console.log(`Prepared release candidate summary: ${outputPath}`);

function artifactForType(type) {
  const artifact = manifestArtifacts.find((candidate) => candidate.type === type);
  if (!artifact) {
    throw new Error(`Release manifest is missing ${type} artifact.`);
  }

  const artifactPath = path.join(releaseAssetsRoot, artifact.file);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Release candidate ${type} artifact file is missing: ${artifact.file}`);
  }

  const bytes = fs.readFileSync(artifactPath);
  if (bytes.length !== artifact.sizeBytes) {
    throw new Error(
      `Release candidate ${type} artifact size mismatch for ${artifact.file}: expected ${artifact.sizeBytes}, got ${bytes.length}.`
    );
  }

  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== artifact.sha256) {
    throw new Error(
      `Release candidate ${type} artifact hash mismatch for ${artifact.file}: expected ${artifact.sha256}, got ${sha256}.`
    );
  }

  return artifact;
}

function validateManifestArtifact(artifact, index) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`Release manifest artifact ${index} must be an object.`);
  }

  const { file, sha256, sizeBytes, type } = artifact;
  if (typeof type !== "string" || !requiredArtifactTypes.has(type)) {
    throw new Error(`Release manifest artifact ${index} has invalid type: ${String(type)}.`);
  }

  if (typeof file !== "string" || file.length === 0 || path.basename(file) !== file) {
    throw new Error(`Release manifest artifact ${index} must use a basename-only file path.`);
  }

  const expectedExtension = requiredArtifactTypes.get(type);
  if (path.extname(file).toLowerCase() !== expectedExtension) {
    throw new Error(
      `Release manifest ${type} artifact must use ${expectedExtension} extension: ${file}.`
    );
  }

  if (!file.includes(`_${packageJson.version}_`)) {
    throw new Error(
      `Release manifest ${type} artifact filename must include package version ${packageJson.version}.`
    );
  }

  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`Release manifest ${type} artifact has invalid sha256.`);
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Release manifest ${type} artifact has invalid sizeBytes.`);
  }

  return { file, sha256, sizeBytes, type };
}
