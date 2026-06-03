import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const expectedTag = `v${packageVersion}`;
const args = process.argv.slice(2);
const ghCommand = process.env.REMOTESHARE_GH_COMMAND || "gh";
const ghCommandArgs = parseCommandArgs(process.env.REMOTESHARE_GH_COMMAND_ARGS);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/download-release-assets.mjs [tag] [output-dir]");
  console.log(`Defaults: tag=${expectedTag}, output-dir=release-assets`);
  process.exit(0);
}

const tag = args[0] ?? expectedTag;
const outputDir = args[1] ?? "release-assets";
const outputParent = path.dirname(path.resolve(outputDir));

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

fs.mkdirSync(outputParent, { recursive: true });
const stagingDir = fs.mkdtempSync(path.join(outputParent, ".remoteshare-release-assets-"));

try {
  const releaseJsonPath = path.join(stagingDir, "github-release.json");
  const release = runGh([
    "release",
    "view",
    tag,
    "--json",
    "tagName,isDraft,assets,url"
  ], { echoOutput: false });
  fs.writeFileSync(releaseJsonPath, release.stdout);

  runGh(["release", "download", tag, "--dir", stagingDir]);
  run(process.execPath, ["scripts/verify-github-release-assets.mjs", releaseJsonPath, stagingDir]);
  run(process.execPath, ["scripts/verify-release-manifest.mjs", stagingDir]);
  verifyGeneratedAsset(
    stagingDir,
    "lan-smoke-report.md",
    "scripts/prepare-lan-smoke-report.mjs",
    "Prefilled LAN smoke report must match downloaded release assets."
  );
  verifyGeneratedAsset(
    stagingDir,
    "release-candidate-summary.md",
    "scripts/release-candidate-summary.mjs",
    "Release candidate summary must match downloaded release assets."
  );

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.renameSync(stagingDir, outputDir);
  console.log(`Downloaded and verified ${tag} release assets in ${outputDir}.`);
} catch (error) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  throw error;
}

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

function runGh(commandArgs, options = {}) {
  return run(ghCommand, [...ghCommandArgs, ...commandArgs], options);
}

function parseCommandArgs(value) {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((arg) => typeof arg !== "string")) {
    throw new Error("REMOTESHARE_GH_COMMAND_ARGS must be a JSON string array.");
  }
  return parsed;
}

function verifyGeneratedAsset(stagingDir, fileName, script, mismatchMessage) {
  const downloadedPath = path.join(stagingDir, fileName);
  if (!fs.existsSync(downloadedPath)) {
    throw new Error(`Downloaded release asset is missing: ${fileName}`);
  }

  const tempDirectory = fs.mkdtempSync(path.join(stagingDir, ".verify-generated-"));
  const expectedPath = path.join(tempDirectory, fileName);
  try {
    run(process.execPath, [script, stagingDir, expectedPath], { echoOutput: false });
    const downloaded = fs.readFileSync(downloadedPath, "utf8");
    const expected = fs.readFileSync(expectedPath, "utf8");
    if (downloaded !== expected) {
      throw new Error(mismatchMessage);
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}
