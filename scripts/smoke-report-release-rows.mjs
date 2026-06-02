import fs from "node:fs";
import path from "node:path";

const releaseAssetsRoot = process.argv[2] ?? "release-assets";
const manifestPath = path.join(releaseAssetsRoot, "RELEASE-MANIFEST.json");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.artifacts)) {
  throw new Error("Release manifest must contain an artifacts array.");
}

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
  const artifact = manifest.artifacts.find((candidate) => candidate.type === type);
  if (!artifact) {
    throw new Error(`Release manifest is missing ${type} artifact.`);
  }

  if (typeof artifact.file !== "string" || typeof artifact.sha256 !== "string") {
    throw new Error(`Release manifest ${type} artifact must include file and sha256.`);
  }

  return artifact;
}
