import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  publishArtifactStatus,
  requiredArtifactTypes
} from "./release-artifacts-lib.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-artifacts-lib-"));

try {
  writeFile("mac/RemoteShare_0.1.9_aarch64.DMG", "dmg");
  writeFile("win/RemoteShare_0.1.9_x64-setup.exe", "exe");
  writeFile("linux/RemoteShare_0.1.9_amd64.deb", "deb");
  writeFile("extra/RemoteShare_0.1.9_x64.msi", "msi");
  writeFile("extra/RemoteShare_0.1.9.AppImage", "appimage");
  writeFile("notes/readme.txt", "notes");

  const requiredTypes = [...requiredArtifactTypes.keys()];
  if (requiredTypes.join(",") !== "dmg,exe,deb") {
    throw new Error(`Unexpected required artifact type order: ${requiredTypes.join(",")}`);
  }

  const artifacts = findInstallerArtifacts(root);
  assertEqual(
    artifacts.map((artifact) => artifact.type).sort().join(","),
    "deb,dmg,exe",
    "required installer artifact types"
  );

  const unexpected = findUnexpectedInstallerArtifacts(root);
  assertEqual(
    unexpected.map((file) => path.basename(file)).join(","),
    "RemoteShare_0.1.9.AppImage,RemoteShare_0.1.9_x64.msi",
    "unexpected installer artifacts"
  );

  assertStatus(
    publishArtifactStatus(artifacts),
    { duplicateTypes: [], missingTypes: [] },
    "complete artifacts"
  );

  assertStatus(
    publishArtifactStatus(artifacts.filter((artifact) => artifact.type !== "deb")),
    { duplicateTypes: [], missingTypes: ["deb"] },
    "missing deb"
  );

  assertStatus(
    publishArtifactStatus([...artifacts, { file: path.join(root, "other.dmg"), type: "dmg" }]),
    { duplicateTypes: ["dmg"], missingTypes: [] },
    "duplicate dmg"
  );

  console.log("Release artifact helper tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeFile(relativePath, body) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertStatus(actual, expected, label) {
  assertEqual(
    actual.duplicateTypes.join(","),
    expected.duplicateTypes.join(","),
    `${label} duplicate types`
  );
  assertEqual(
    actual.missingTypes.join(","),
    expected.missingTypes.join(","),
    `${label} missing types`
  );
}
