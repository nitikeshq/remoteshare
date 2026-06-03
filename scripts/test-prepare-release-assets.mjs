import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-prepare-assets-"));
const preparer = path.resolve("scripts/prepare-release-assets.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = "2026-06-02T12:34:56.789Z";

try {
  const validSource = fixture("valid-source", [
    [`remoteshare-macos/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`remoteshare-windows/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`remoteshare-linux/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  const validOutput = path.join(root, "valid-output");
  fs.mkdirSync(validOutput, { recursive: true });
  fs.writeFileSync(path.join(validOutput, "stale.exe"), "stale exe");
  runPreparer(validSource, validOutput, true, "valid release assets should pass");
  assertFile(validOutput, `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg");
  assertFile(validOutput, `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe");
  assertFile(validOutput, `RemoteShare_${packageVersion}_amd64.deb`, "valid deb");
  assertMissingFile(validOutput, "stale.exe");
  assertChecksums(validOutput, [
    [`RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  assertManifest(validOutput, [
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"],
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]
  ]);

  const missingLinuxSource = fixture("missing-linux", [
    [`remoteshare-macos/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`remoteshare-windows/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]
  ]);
  runPreparer(
    missingLinuxSource,
    path.join(root, "missing-linux-output"),
    false,
    "missing Linux artifact should fail",
    "Missing publish artifact type(s): deb"
  );

  const duplicateSource = fixture("duplicate-source", [
    [`one/RemoteShare_${packageVersion}_x64-setup.exe`, "first exe"],
    [`two/RemoteShare_${packageVersion}_x64-setup.exe`, "second exe"],
    [`mac/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`linux/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runPreparer(
    duplicateSource,
    path.join(root, "duplicate-output"),
    false,
    "duplicate basenames should fail",
    "Duplicate release asset filename"
  );

  const duplicateTypeSource = fixture("duplicate-type-source", [
    [`one/RemoteShare_${packageVersion}_x64-setup.exe`, "first exe"],
    [`two/RemoteShare_${packageVersion}_arm64-setup.exe`, "second exe"],
    [`mac/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`linux/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runPreparer(
    duplicateTypeSource,
    path.join(root, "duplicate-type-output"),
    false,
    "duplicate platform artifact type should fail",
    "Expected exactly one publish artifact per type; duplicate type(s): exe"
  );

  const unexpectedSource = fixture("unexpected-installer-source", [
    [`mac/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`win/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`linux/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"],
    [`win/RemoteShare_${packageVersion}_x64.msi`, "unexpected msi"]
  ]);
  runPreparer(
    unexpectedSource,
    path.join(root, "unexpected-installer-output"),
    false,
    "unexpected installer artifact should fail",
    "Unexpected publish installer artifact(s)"
  );

  const emptyArtifactSource = fixture("empty-artifact-source", [
    [`mac/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`win/RemoteShare_${packageVersion}_x64-setup.exe`, ""],
    [`linux/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runPreparer(
    emptyArtifactSource,
    path.join(root, "empty-artifact-output"),
    false,
    "empty installer artifact should fail",
    "Empty publish installer artifact(s)"
  );

  const nestedOutputSource = fixture("nested-output-source", [
    [`mac/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`win/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`linux/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runPreparer(
    nestedOutputSource,
    path.join(nestedOutputSource, "release-assets"),
    false,
    "nested release asset output should fail",
    "Release asset output directory must be outside"
  );

  const wrongVersionSource = fixture("wrong-version-source", [
    [`mac/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["win/RemoteShare_9.9.9_x64-setup.exe", "wrong exe"],
    [`linux/RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runPreparer(
    wrongVersionSource,
    path.join(root, "wrong-version-output"),
    false,
    "wrong version installer artifact should fail",
    `Release asset filename must include package version ${packageVersion}`
  );

  console.log("Release asset preparation tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });

  for (const [relativePath, body] of files) {
    const file = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }

  return directory;
}

function runPreparer(source, output, shouldPass, label, expectedOutput = "") {
  const result = spawnSync(process.execPath, [preparer, source, output], {
    encoding: "utf8",
    env: { ...process.env, REMOTESHARE_RELEASE_GENERATED_AT: generatedAt }
  });
  const commandOutput = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${commandOutput}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${commandOutput}`);
  }

  if (expectedOutput && !commandOutput.includes(expectedOutput)) {
    throw new Error(`${label}: expected output to include ${expectedOutput}\n${commandOutput}`);
  }
}

function assertFile(directory, basename, expectedBody) {
  const file = path.join(directory, basename);
  if (fs.readFileSync(file, "utf8") !== expectedBody) {
    throw new Error(`Unexpected release asset body for ${basename}`);
  }
}

function assertMissingFile(directory, basename) {
  const file = path.join(directory, basename);
  if (fs.existsSync(file)) {
    throw new Error(`Stale release asset was not removed: ${basename}`);
  }
}

function assertChecksums(directory, expectedFiles) {
  const checksumFile = path.join(directory, "SHA256SUMS.txt");
  const actual = fs.readFileSync(checksumFile, "utf8").trim().split(/\r?\n/).sort();
  const expected = expectedFiles
    .map(([basename, body]) => `${sha256(body)}  ${basename}`)
    .sort();

  if (actual.join("\n") !== expected.join("\n")) {
    throw new Error(`Unexpected release checksum file:\n${actual.join("\n")}`);
  }
}

function assertManifest(directory, expectedFiles) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "RELEASE-MANIFEST.json"), "utf8")
  );
  if (manifest.version !== packageVersion) {
    throw new Error(`Unexpected release manifest version: ${String(manifest.version)}`);
  }
  if (manifest.generatedAt !== generatedAt) {
    throw new Error(`Unexpected release manifest generatedAt: ${String(manifest.generatedAt)}`);
  }
  const actual = manifest.artifacts.map((artifact) => [
    artifact.type,
    artifact.file,
    artifact.sha256,
    artifact.sizeBytes
  ]);
  const expected = expectedFiles.map(([type, basename, body]) => [
    type,
    basename,
    sha256(body),
    Buffer.byteLength(body)
  ]);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected release manifest:\n${JSON.stringify(manifest, null, 2)}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
