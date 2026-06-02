import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-publish-artifacts-"));
const verifier = path.resolve("scripts/verify-publish-artifacts.mjs");

try {
  const validRoot = fixture("valid", [
    "remoteshare-macos/RemoteShare_0.1.13_aarch64.dmg",
    "remoteshare-windows/RemoteShare_0.1.13_x64-setup.exe",
    "remoteshare-linux/RemoteShare_0.1.13_amd64.deb"
  ]);
  runVerifier(validRoot, true, "all platform artifacts should pass");

  const missingLinuxRoot = fixture("missing-linux", [
    "remoteshare-macos/RemoteShare_0.1.13_aarch64.dmg",
    "remoteshare-windows/RemoteShare_0.1.13_x64-setup.exe"
  ]);
  runVerifier(
    missingLinuxRoot,
    false,
    "missing Linux artifact should fail",
    "Missing publish artifact type(s): deb"
  );

  const missingAllRoot = fixture("missing-all", []);
  runVerifier(
    missingAllRoot,
    false,
    "missing all artifacts should fail",
    "Missing publish artifact type(s): dmg, exe, deb"
  );

  const unexpectedRoot = fixture("unexpected-installer", [
    "remoteshare-macos/RemoteShare_0.1.13_aarch64.dmg",
    "remoteshare-windows/RemoteShare_0.1.13_x64-setup.exe",
    "remoteshare-linux/RemoteShare_0.1.13_amd64.deb",
    "remoteshare-windows/RemoteShare_0.1.13_x64.msi"
  ]);
  runVerifier(
    unexpectedRoot,
    false,
    "unexpected installer artifact should fail",
    "Unexpected publish installer artifact(s)"
  );

  const duplicateTypeRoot = fixture("duplicate-type", [
    "remoteshare-macos/RemoteShare_0.1.13_aarch64.dmg",
    "remoteshare-macos/RemoteShare_0.1.13_x64.dmg",
    "remoteshare-windows/RemoteShare_0.1.13_x64-setup.exe",
    "remoteshare-linux/RemoteShare_0.1.13_amd64.deb"
  ]);
  runVerifier(
    duplicateTypeRoot,
    false,
    "duplicate platform artifact type should fail",
    "Expected exactly one publish artifact per type; duplicate type(s): dmg"
  );

  const emptyArtifactRoot = fixture("empty-artifact", [
    "remoteshare-macos/RemoteShare_0.1.13_aarch64.dmg",
    "remoteshare-windows/RemoteShare_0.1.13_x64-setup.exe",
    "remoteshare-linux/RemoteShare_0.1.13_amd64.deb"
  ]);
  fs.writeFileSync(
    path.join(emptyArtifactRoot, "remoteshare-windows/RemoteShare_0.1.13_x64-setup.exe"),
    ""
  );
  runVerifier(
    emptyArtifactRoot,
    false,
    "empty installer artifact should fail",
    "Empty publish installer artifact(s)"
  );

  console.log("Publish artifact verifier tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });

  for (const relativePath of files) {
    const file = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, relativePath);
  }

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
