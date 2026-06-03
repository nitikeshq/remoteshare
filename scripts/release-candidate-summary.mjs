import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  publishArtifactStatus,
  requiredArtifactTypes,
  validateReleaseGeneratedAt,
  validateReleaseManifestArtifact
} from "./release-artifacts-lib.mjs";

const releaseAssetsRoot = process.argv[2] ?? "release-assets";
const outputPath = process.argv[3] ?? path.join(releaseAssetsRoot, "release-candidate-summary.md");
const manifestPath = path.join(releaseAssetsRoot, "RELEASE-MANIFEST.json");
const readinessAssetsPath = "release-assets";
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

validateReleaseGeneratedAt(manifest.generatedAt);
const manifestArtifacts = manifest.artifacts.map((artifact, index) =>
  validateReleaseManifestArtifact(artifact, index, packageJson.version)
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
5. Record a Test date that is on or after the release manifest date and not in the future.
6. Record startup health TCP ready, UDP ready, and start-at-login not failed detail strings after restart.
7. Record accepted \`key press r\` test input plus the Input Transport source device and relative time shown on the Windows receiver.
8. Record active capture target and elapsed start time before pressing Stop.
9. Record capture start/stop evidence with accepted mouse move, mouse click, scroll, and key events on the Windows receiver.
10. In the manual fallback run, record the copied endpoint label shown in the peer \`This computer\` row as Best LAN IPv4, LAN IPv4, or LAN IPv6.
11. In the manual fallback run, record the endpoint source as saved endpoint or manual IP and a successful TCP 44777 probe such as Test-NetConnection, nc/netcat, telnet, socket connect, or port probe. If a retry was needed, record the visible manual IP / Set IP / Verify IP recovery hint, copied endpoint, TCP 44777, or firewall evidence.
12. Verify the completed report:

\`\`\`bash
npm run verify:lan-smoke-report -- path/to/completed-lan-smoke-report.md
npm run verify:release-readiness -- ${readinessAssetsPath} path/to/completed-lan-smoke-report.md
\`\`\`

Do not publish the draft release until both verification commands pass against the completed real Mac-to-Windows LAN smoke report.

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
