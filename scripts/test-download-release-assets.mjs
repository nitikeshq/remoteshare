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

  console.log("Download release assets tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function releaseFixture(name) {
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
  fs.writeFileSync(
    path.join(assetsRoot, "RELEASE-MANIFEST.json"),
    `${JSON.stringify({ version: packageVersion, generatedAt, artifacts }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(assetsRoot, "lan-smoke-report.md"), "# LAN smoke report\n");
  fs.writeFileSync(path.join(assetsRoot, "release-candidate-summary.md"), "# Release candidate\n");

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
  const ghPath = path.join(bin, "gh");
  fs.writeFileSync(
    ghPath,
    `#!/usr/bin/env node
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
`,
    { mode: 0o755 }
  );
  return {
    path: bin,
    env: {
      REMOTESHARE_FAKE_GH_ASSETS: fixture.assetsRoot,
      REMOTESHARE_FAKE_GH_RELEASE_JSON: fixture.releaseJson
    }
  };
}

function runDownloader(fakeBin, args, shouldPass, label, expectedOutput) {
  const result = spawnSync(process.execPath, [downloader, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...fakeBin.env,
      PATH: `${fakeBin.path}${path.delimiter}${process.env.PATH ?? ""}`
    }
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

function assertExists(directory, file) {
  const filePath = path.join(directory, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected downloaded asset to exist: ${filePath}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
