import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const expectedTag = `v${packageVersion}`;
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/download-release-assets.mjs [tag] [output-dir]");
  console.log(`Defaults: tag=${expectedTag}, output-dir=release-assets`);
  process.exit(0);
}

const tag = args[0] ?? expectedTag;
const outputDir = args[1] ?? "release-assets";

if (tag !== expectedTag) {
  throw new Error(
    `Release tag must match package version ${expectedTag}; got ${tag}. Check out the matching tag or bump package metadata before downloading.`
  );
}

if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
  throw new Error(
    `Release asset output directory must be empty to avoid stale artifact mixups: ${outputDir}`
  );
}

fs.mkdirSync(outputDir, { recursive: true });

const releaseJsonPath = path.join(outputDir, "github-release.json");
const release = run("gh", [
  "release",
  "view",
  tag,
  "--json",
  "tagName,isDraft,assets,url"
], { echoOutput: false });
fs.writeFileSync(releaseJsonPath, release.stdout);

run("gh", ["release", "download", tag, "--dir", outputDir]);
run(process.execPath, ["scripts/verify-github-release-assets.mjs", releaseJsonPath, outputDir]);
run(process.execPath, ["scripts/verify-release-manifest.mjs", outputDir]);

console.log(`Downloaded and verified ${tag} release assets in ${outputDir}.`);

function run(command, commandArgs, options = {}) {
  const { echoOutput = true } = options;
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`${command} ${commandArgs.join(" ")} failed.\n${output}`);
  }

  if (echoOutput && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (echoOutput && result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}
