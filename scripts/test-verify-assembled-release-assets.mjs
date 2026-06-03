import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-verify-assembled-assets-"));
const verifier = path.resolve("scripts/verify-assembled-release-assets.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = "2026-06-01T10:00:00.000Z";

try {
  const validAssets = releaseAssetsFixture("valid");
  runVerifier(validAssets, true, "valid assembled assets should pass", [
    "Verified release manifest for 3 artifact(s).",
    "Verified assembled release assets"
  ]);

  const extraAssets = releaseAssetsFixture("extra-file");
  fs.writeFileSync(path.join(extraAssets, "debug.log"), "debug");
  runVerifier(extraAssets, false, "extra assembled asset should fail", [
    "unexpected file(s): debug.log"
  ]);

  const nestedAssets = releaseAssetsFixture("nested-directory");
  fs.mkdirSync(path.join(nestedAssets, "windows"), { recursive: true });
  runVerifier(nestedAssets, false, "nested assembled asset directory should fail", [
    "must be flat"
  ]);

  const staleSmokeAssets = releaseAssetsFixture("stale-smoke");
  fs.writeFileSync(path.join(staleSmokeAssets, "lan-smoke-report.md"), "# stale\n");
  runVerifier(staleSmokeAssets, false, "stale smoke report should fail", [
    "Prefilled LAN smoke report must match assembled release assets."
  ]);

  const missingSummaryAssets = releaseAssetsFixture("missing-summary");
  fs.rmSync(path.join(missingSummaryAssets, "release-candidate-summary.md"));
  runVerifier(missingSummaryAssets, false, "missing release summary should fail", [
    "missing file(s): release-candidate-summary.md"
  ]);

  console.log("Assembled release asset verifier tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function releaseAssetsFixture(name) {
  const assetsRoot = path.join(root, name);
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
  run(process.execPath, [
    "scripts/prepare-lan-smoke-report.mjs",
    assetsRoot,
    path.join(assetsRoot, "lan-smoke-report.md")
  ]);
  run(process.execPath, [
    "scripts/release-candidate-summary.mjs",
    assetsRoot,
    path.join(assetsRoot, "release-candidate-summary.md")
  ]);

  return assetsRoot;
}

function runVerifier(assetsRoot, shouldPass, label, expectedOutput) {
  const result = spawnSync(process.execPath, [verifier, assetsRoot], { encoding: "utf8" });
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

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
