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

if (fs.existsSync(outputPath)) {
  throw new Error(`Release candidate summary already exists: ${outputPath}`);
}

const manifest = readReleaseManifest(manifestPath);
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
4. Use the setup checklist \`Copy\` button on each computer to paste role, platform, first-MVP input direction, and checklist step evidence. Paste the Mac sender setup checklist output into both macOS permission rows so they show \`Mac input permissions: done\` with Accessibility and Input Monitoring.
5. Fill the model/version rows with the physical Mac and Windows computers plus OS versions, for example \`MacBook Pro M2 / macOS 15\` and \`Windows laptop PC / Windows 11\`.
6. Record firewall evidence that shows allowed/successful rules for TCP \`44777\` and UDP \`44778\` on both computers.
7. Use the pending pairing row \`Copy\` button to paste pairing direction, this computer, visible code, typed-code state, local/remote approval, and expiry evidence into the pair-action, visible-code, typed-code, and pairing-evidence rows.
8. Use the Trusted Device Audit peer row \`Evidence\` button to paste this computer, local fingerprint, peer, peer role, and peer fingerprint evidence into the trusted and fingerprint rows.
9. Record a Test date that is on or after the release manifest date and not in the future.
10. Use the Startup health \`Copy\` button to paste \`Startup health\`, \`This computer\`, \`TCP:\`, \`UDP:\`, \`Start:\`, and started/reconnect timing evidence after restart.
11. After restart/wake, use the trusted row reconnect \`Copy\` button to paste the full reconnect output: this computer, trusted device, \`Auto reconnect: enabled\`, \`Check: reachable\`, \`Verification: after restart/wake\`, measured latency, last-seen timing, endpoint source, endpoint, last failure, and recovery evidence.
12. Use the trusted row receive \`Copy\` button to paste \`Allow incoming control: enabled\`, \`Device receive: enabled\`, and \`Input control: ready\` evidence before input.
13. Use the Input Transport row \`Copy\` button on the Mac sender to paste \`Input Transport: Outgoing\`, \`This computer\`, \`Summary: key press r\`, target device, relative time, and \`Status: Accepted\` evidence for the accepted test input. Also use the Input Transport row \`Copy\` button on the Windows receiver to paste \`Input Transport: Incoming\`, \`This computer\`, \`Summary: key press r\`, source device, relative time, and \`Status: Accepted\` evidence.
14. Before pressing Stop, use the active capture \`Copy\` button to paste \`Capture: active\`, \`This computer\`, target, and started/elapsed-time evidence.
15. After pressing Stop, use the stopped capture \`Copy\` button to paste \`Capture: stopped\`, \`This computer\`, target, started/stopped timing, and \`Result: stopped cleanly\`; also paste receiver Input Transport row \`Copy\` output for accepted incoming mouse move, mouse click, scroll, and key events on the Windows receiver.
16. In the auto-discovery run, the copied reconnect evidence must show endpoint source as discovery, reconnect, or saved endpoint exactly as shown in the UI, and it must include measured latency.
17. In the manual fallback run, paste the peer \`This computer\` row's local endpoint \`Evidence\` output so the report records \`Local endpoint\`, \`This computer\`, \`Label: Best LAN IPv4\` / \`LAN IPv4\` / \`LAN IPv6\`, endpoint, TCP 44777, private-network state, and \`Manual fallback: preferred LAN IPv4\` / \`LAN IPv4\` / \`LAN IPv6\`; \`Endpoint used\` must match the copied endpoint.
18. In the manual fallback run, the copied reconnect evidence must show endpoint source as saved endpoint or manual IP and include measured latency, and the report must include a successful TCP 44777 probe such as Test-NetConnection, nc/netcat, telnet, socket connect, or port probe. If a retry was needed, use the trusted IP update \`Copy\` button to paste this computer, device, recovery action, endpoint field, copied endpoint, TCP port, current endpoint/source, last failure, and recovery hint evidence; the copied endpoint must be concrete and match the manual fallback \`Endpoint used\`.
19. Confirm Notes show \`Blocking issues: none\`, identify screenshots or logs captured for pairing, reconnect, input, and capture evidence, and show \`Retest required: no\`; unresolved blocking issues, incomplete captured-evidence notes, or required retests fail release readiness.
20. Verify the completed report:

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

function readReleaseManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid release manifest JSON: ${error.message}`);
    }
    throw error;
  }
}

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
