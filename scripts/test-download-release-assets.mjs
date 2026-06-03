import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-download-release-assets-"));
const downloader = path.resolve("scripts/download-release-assets.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = "2026-06-01T10:00:00.000Z";

try {
  const fixture = releaseFixture("valid");
  const fakeBin = fakeGhBin(fixture);
  const outputDir = path.join(root, "downloaded-assets");
  runDownloader(fakeBin, [`v${packageVersion}`, outputDir], true, "valid download should pass", [
    `Downloaded and verified v${packageVersion} release assets`,
    `Verified 7 GitHub release asset(s) for v${packageVersion}`,
    "Verified release manifest for 3 artifact(s)."
  ]);
  assertExists(outputDir, "github-release.json");
  assertExists(outputDir, `RemoteShare_${packageVersion}_aarch64.dmg`);
  assertExists(outputDir, `RemoteShare_${packageVersion}_x64-setup.exe`);
  assertExists(outputDir, `RemoteShare_${packageVersion}_amd64.deb`);

  const nonEmptyOutput = path.join(root, "non-empty-output");
  fs.mkdirSync(nonEmptyOutput, { recursive: true });
  fs.writeFileSync(path.join(nonEmptyOutput, "stale.txt"), "stale");
  runDownloader(
    fakeBin,
    [`v${packageVersion}`, nonEmptyOutput],
    false,
    "non-empty output should fail",
    ["must be empty to avoid stale artifact mixups"]
  );

  runDownloader(
    fakeBin,
    ["v9.9.9", path.join(root, "wrong-tag")],
    false,
    "wrong tag should fail",
    [`Release tag must match package version v${packageVersion}`]
  );

  const invalidFixture = releaseFixture("invalid-downloaded-manifest", {
    mutateManifest: (manifest) => {
      const { generatedAt: _generatedAt, ...withoutGeneratedAt } = manifest;
      return withoutGeneratedAt;
    }
  });
  const invalidFakeBin = fakeGhBin(invalidFixture);
  const failedOutputDir = path.join(root, "failed-download-output");
  runDownloader(
    invalidFakeBin,
    [`v${packageVersion}`, failedOutputDir],
    false,
    "failed verification should not publish output",
    ["generatedAt must be a valid ISO-8601 UTC timestamp"]
  );
  assertMissing(failedOutputDir, "github-release.json");
  assertMissing(failedOutputDir, "RELEASE-MANIFEST.json");

  const staleSmokeFixture = releaseFixture("stale-smoke-report", {
    mutateAsset: (assetName, body) =>
      assetName === "lan-smoke-report.md" ? "# stale smoke report\n" : body
  });
  const staleSmokeFakeBin = fakeGhBin(staleSmokeFixture);
  const staleSmokeOutputDir = path.join(root, "stale-smoke-output");
  runDownloader(
    staleSmokeFakeBin,
    [`v${packageVersion}`, staleSmokeOutputDir],
    false,
    "stale downloaded LAN smoke report should fail",
    ["Prefilled LAN smoke report must match downloaded release assets"]
  );
  assertMissing(staleSmokeOutputDir, "lan-smoke-report.md");

  const staleSummaryFixture = releaseFixture("stale-release-summary", {
    mutateAsset: (assetName, body) =>
      assetName === "release-candidate-summary.md" ? "# stale release candidate\n" : body
  });
  const staleSummaryFakeBin = fakeGhBin(staleSummaryFixture);
  const staleSummaryOutputDir = path.join(root, "stale-summary-output");
  runDownloader(
    staleSummaryFakeBin,
    [`v${packageVersion}`, staleSummaryOutputDir],
    false,
    "stale downloaded release candidate summary should fail",
    ["Release candidate summary must match downloaded release assets"]
  );
  assertMissing(staleSummaryOutputDir, "release-candidate-summary.md");

  console.log("Download release assets tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function releaseFixture(name, options = {}) {
  const assetsRoot = path.join(root, name, "assets");
  fs.mkdirSync(assetsRoot, { recursive: true });
  const artifacts = [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ].map(([type, file, body]) => {
    fs.writeFileSync(path.join(assetsRoot, file), body);
    return {
      file,
      sha256: sha256(body),
      sizeBytes: Buffer.byteLength(body),
      type
    };
  });

  fs.writeFileSync(
    path.join(assetsRoot, "SHA256SUMS.txt"),
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`).sort().join("\n")}\n`
  );
  const manifestPath = path.join(assetsRoot, "RELEASE-MANIFEST.json");
  const manifest = { version: packageVersion, generatedAt, artifacts };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const smokeReportPath = path.join(assetsRoot, "lan-smoke-report.md");
  const summaryPath = path.join(assetsRoot, "release-candidate-summary.md");
  run(process.execPath, ["scripts/prepare-lan-smoke-report.mjs", assetsRoot, smokeReportPath]);
  run(process.execPath, ["scripts/release-candidate-summary.mjs", assetsRoot, summaryPath]);

  const mutatedManifest = options.mutateManifest?.(manifest);
  if (mutatedManifest) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(mutatedManifest, null, 2)}\n`);
  }

  for (const assetName of ["lan-smoke-report.md", "release-candidate-summary.md"]) {
    const assetPath = path.join(assetsRoot, assetName);
    const body = fs.readFileSync(assetPath);
    const mutated = options.mutateAsset?.(assetName, body);
    if (mutated !== undefined) {
      fs.writeFileSync(assetPath, mutated);
    }
  }

  const releaseJson = path.join(root, name, "github-release.json");
  const assetNames = [
    ...artifacts.map((artifact) => artifact.file),
    "SHA256SUMS.txt",
    "RELEASE-MANIFEST.json",
    "lan-smoke-report.md",
    "release-candidate-summary.md"
  ];
  const assets = assetNames.map((assetName) => {
    const body = fs.readFileSync(path.join(assetsRoot, assetName));
    return {
      name: assetName,
      size: body.byteLength,
      digest: `sha256:${sha256(body)}`
    };
  });
  fs.writeFileSync(
    releaseJson,
    `${JSON.stringify({ tagName: `v${packageVersion}`, isDraft: true, assets }, null, 2)}\n`
  );

  return { assetsRoot, releaseJson };
}

function fakeGhBin(fixture) {
  const bin = path.join(root, "fake-bin");
  fs.mkdirSync(bin, { recursive: true });
  const ghScriptPath = path.join(bin, "gh.mjs");
  fs.writeFileSync(
    ghScriptPath,
    `
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const assetsRoot = process.env.REMOTESHARE_FAKE_GH_ASSETS;
const releaseJson = process.env.REMOTESHARE_FAKE_GH_RELEASE_JSON;

if (args.join(" ") === "release view v${packageVersion} --json tagName,isDraft,assets,url") {
  process.stdout.write(fs.readFileSync(releaseJson, "utf8"));
  process.exit(0);
}

if (args[0] === "release" && args[1] === "download" && args[2] === "v${packageVersion}") {
  const dirIndex = args.indexOf("--dir");
  const outputDir = dirIndex >= 0 ? args[dirIndex + 1] : ".";
  fs.mkdirSync(outputDir, { recursive: true });
  for (const file of fs.readdirSync(assetsRoot)) {
    fs.copyFileSync(path.join(assetsRoot, file), path.join(outputDir, file));
  }
  process.exit(0);
}

console.error("unexpected fake gh args: " + args.join(" "));
process.exit(1);
`
  );
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/usr/bin/env sh
exec "${process.execPath}" "$(dirname "$0")/gh.mjs" "$@"
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, "gh.cmd"),
    `@echo off\r\n"${process.execPath}" "%~dp0gh.mjs" %*\r\n`
  );
  return {
    path: bin,
    command: process.execPath,
    commandArgs: [ghScriptPath],
    env: {
      REMOTESHARE_FAKE_GH_ASSETS: fixture.assetsRoot,
      REMOTESHARE_FAKE_GH_RELEASE_JSON: fixture.releaseJson
    }
  };
}

function runDownloader(fakeBin, args, shouldPass, label, expectedOutput) {
  const env = withPrependedPath({
    ...process.env,
    ...fakeBin.env,
    REMOTESHARE_GH_COMMAND: fakeBin.command,
    REMOTESHARE_GH_COMMAND_ARGS: JSON.stringify(fakeBin.commandArgs)
  }, fakeBin.path);
  const result = spawnSync(process.execPath, [downloader, ...args], {
    encoding: "utf8",
    env
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  for (const expected of expectedOutput) {
    if (!output.includes(expected)) {
      throw new Error(`${label}: expected output to include ${expected}\n${output}`);
    }
  }
}

function withPrependedPath(env, directory) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  for (const key of Object.keys(env)) {
    if (key !== pathKey && key.toLowerCase() === "path") {
      delete env[key];
    }
  }
  env[pathKey] = `${directory}${path.delimiter}${env[pathKey] ?? ""}`;
  return env;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.\n${result.stdout}\n${result.stderr}`);
  }
}

function assertExists(directory, file) {
  const filePath = path.join(directory, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected downloaded asset to exist: ${filePath}`);
  }
}

function assertMissing(directory, file) {
  const filePath = path.join(directory, file);
  if (fs.existsSync(filePath)) {
    throw new Error(`Expected failed download to keep output clean: ${filePath}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
