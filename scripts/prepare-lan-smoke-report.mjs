import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const releaseAssetsRoot = process.argv[2] ?? "release-assets";
const outputPath = process.argv[3] ?? "lan-smoke-report.md";
const templatePath = "docs/lan-smoke-report-template.md";
const manifestPath = path.join(releaseAssetsRoot, "RELEASE-MANIFEST.json");

if (!fs.existsSync(templatePath)) {
  throw new Error(`Missing LAN smoke report template: ${templatePath}`);
}

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

if (fs.existsSync(outputPath)) {
  throw new Error(`LAN smoke report already exists: ${outputPath}`);
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.version !== packageJson.version) {
  throw new Error(
    `Release manifest version must match package version ${packageJson.version}.`
  );
}

if (!Array.isArray(manifest.artifacts)) {
  throw new Error("Release manifest must contain an artifacts array.");
}

const dmg = artifactForType("dmg");
const exe = artifactForType("exe");
const deb = artifactForType("deb");
let report = fs.readFileSync(templatePath, "utf8");

report = fillRow(report, "RemoteShare version/tag", `v${packageJson.version}`);
report = fillRow(report, "macOS installer file", dmg.file);
report = fillRow(report, "macOS installer SHA256", dmg.sha256);
report = fillRow(report, "Windows installer file", exe.file);
report = fillRow(report, "Windows installer SHA256", exe.sha256);
report = fillRow(report, "Linux installer file", deb.file);
report = fillRow(report, "Linux installer SHA256", deb.sha256);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, report);
console.log(`Prepared LAN smoke report: ${outputPath}`);

function artifactForType(type) {
  const artifact = manifest.artifacts.find((candidate) => candidate.type === type);
  if (!artifact) {
    throw new Error(`Release manifest is missing ${type} artifact.`);
  }

  if (typeof artifact.file !== "string" || artifact.file.length === 0 || path.basename(artifact.file) !== artifact.file) {
    throw new Error(`Release manifest ${type} artifact must use a basename-only file path.`);
  }

  if (!artifact.file.includes(`_${packageJson.version}_`)) {
    throw new Error(
      `Release manifest ${type} artifact filename must include package version ${packageJson.version}.`
    );
  }

  const expectedExtension = type === "dmg" ? ".dmg" : type === "exe" ? ".exe" : ".deb";
  if (path.extname(artifact.file).toLowerCase() !== expectedExtension) {
    throw new Error(`Release manifest ${type} artifact must use ${expectedExtension} extension.`);
  }

  if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    throw new Error(`Release manifest ${type} artifact has invalid sha256.`);
  }

  if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
    throw new Error(`Release manifest ${type} artifact has invalid sizeBytes.`);
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

function fillRow(markdown, field, value) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\| ${escaped} \\|\\s*\\|`);
  if (!pattern.test(markdown)) {
    throw new Error(`Missing smoke report template row: ${field}`);
  }
  return markdown.replace(pattern, `| ${field} | ${value} |`);
}
