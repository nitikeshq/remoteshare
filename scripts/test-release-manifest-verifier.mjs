import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-manifest-"));
const verifier = path.resolve("scripts/verify-release-manifest.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = "2026-06-01T10:00:00.000Z";

try {
  const valid = fixture("valid", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runVerifier(valid, true, "valid manifest should pass", "Verified release manifest for 3 artifact(s).");

  const missingManifest = fixture("missing-manifest", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  fs.rmSync(path.join(missingManifest, "RELEASE-MANIFEST.json"));
  runVerifier(missingManifest, false, "missing manifest should fail", "Missing release manifest");

  const wrongHash = fixture("wrong-hash", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  const wrongHashManifest = readManifest(wrongHash);
  wrongHashManifest.artifacts[0].sha256 = sha256("different");
  writeManifest(wrongHash, wrongHashManifest);
  runVerifier(wrongHash, false, "wrong manifest hash should fail", "Checksum mismatch");

  const staleChecksum = fixture("stale-checksum", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  fs.appendFileSync(path.join(staleChecksum, "SHA256SUMS.txt"), `${sha256("stale")}  stale.exe\n`);
  runVerifier(staleChecksum, false, "stale checksum entry should fail", "stale entry");

  const extraInstaller = fixture("extra-installer", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  fs.writeFileSync(path.join(extraInstaller, `RemoteShare_${packageVersion}_x64.dmg`), "extra dmg");
  runVerifier(
    extraInstaller,
    false,
    "extra installer should fail",
    "not present in manifest"
  );

  const unexpectedInstaller = fixture("unexpected-installer", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  fs.writeFileSync(
    path.join(unexpectedInstaller, `RemoteShare_${packageVersion}_x64.msi`),
    "unexpected msi"
  );
  runVerifier(
    unexpectedInstaller,
    false,
    "unexpected installer should fail",
    "unexpected installer artifact"
  );

  const traversal = fixture("path-traversal", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  const traversalManifest = readManifest(traversal);
  traversalManifest.artifacts[0].file = `../RemoteShare_${packageVersion}_aarch64.dmg`;
  writeManifest(traversal, traversalManifest);
  runVerifier(traversal, false, "path traversal manifest entry should fail", "basename-only");

  const duplicateType = fixture("duplicate-type", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["exe", `RemoteShare_${packageVersion}_arm64-setup.exe`, "second exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runVerifier(duplicateType, false, "duplicate manifest type should fail", "duplicate type(s): exe");

  const emptyArtifact = fixture("empty-artifact", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, ""],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runVerifier(emptyArtifact, false, "empty manifest artifact should fail", "invalid sizeBytes");

  const wrongManifestVersion = fixture("wrong-manifest-version", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  const wrongManifestVersionJson = readManifest(wrongManifestVersion);
  wrongManifestVersionJson.version = "9.9.9";
  writeManifest(wrongManifestVersion, wrongManifestVersionJson);
  runVerifier(
    wrongManifestVersion,
    false,
    "wrong manifest version should fail",
    `Release manifest version must match package version ${packageVersion}`
  );

  const wrongArtifactVersion = fixture("wrong-artifact-version", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", "RemoteShare_9.9.9_x64-setup.exe", "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runVerifier(
    wrongArtifactVersion,
    false,
    "wrong artifact filename version should fail",
    `must include package version ${packageVersion}`
  );

  const missingGeneratedAt = fixture("missing-generated-at", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  const missingGeneratedAtJson = readManifest(missingGeneratedAt);
  delete missingGeneratedAtJson.generatedAt;
  writeManifest(missingGeneratedAt, missingGeneratedAtJson);
  runVerifier(
    missingGeneratedAt,
    false,
    "missing generatedAt should fail",
    "generatedAt must be a valid ISO-8601 UTC timestamp"
  );

  const invalidGeneratedAt = fixture("invalid-generated-at", [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  const invalidGeneratedAtJson = readManifest(invalidGeneratedAt);
  invalidGeneratedAtJson.generatedAt = "2026-06-01";
  writeManifest(invalidGeneratedAt, invalidGeneratedAtJson);
  runVerifier(
    invalidGeneratedAt,
    false,
    "invalid generatedAt should fail",
    "generatedAt must be a valid ISO-8601 UTC timestamp"
  );

  console.log("Release manifest verifier tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });

  const artifacts = files.map(([type, basename, body]) => {
    fs.writeFileSync(path.join(directory, basename), body);
    return {
      file: basename,
      sha256: sha256(body),
      sizeBytes: Buffer.byteLength(body),
      type
    };
  });

  fs.writeFileSync(
    path.join(directory, "SHA256SUMS.txt"),
    `${artifacts
      .map((artifact) => `${artifact.sha256}  ${artifact.file}`)
      .sort()
      .join("\n")}\n`
  );
  writeManifest(directory, {
    version: packageVersion,
    generatedAt,
    artifacts: artifacts.sort((a, b) => a.type.localeCompare(b.type))
  });

  return directory;
}

function runVerifier(directory, shouldPass, label, expectedOutput = "") {
  const result = spawnSync(process.execPath, [verifier, directory], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  if (expectedOutput && !output.includes(expectedOutput)) {
    throw new Error(`${label}: expected output to include ${expectedOutput}\n${output}`);
  }
}

function readManifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, "RELEASE-MANIFEST.json"), "utf8"));
}

function writeManifest(directory, manifest) {
  fs.writeFileSync(
    path.join(directory, "RELEASE-MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
