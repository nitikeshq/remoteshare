import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  publishArtifactStatus,
  requiredArtifactTypes,
  validateManifestArtifactTypes,
  validateReleaseManifestArtifact
} from "./release-artifacts-lib.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-artifacts-lib-"));

try {
  writeFile("mac/RemoteShare_0.1.13_aarch64.DMG", "dmg");
  writeFile("win/RemoteShare_0.1.13_x64-setup.exe", "exe");
  writeFile("linux/RemoteShare_0.1.13_amd64.deb", "deb");
  writeFile("extra/RemoteShare_0.1.13_x64.msi", "msi");
  writeFile("extra/RemoteShare_0.1.13.AppImage", "appimage");
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
    "RemoteShare_0.1.13.AppImage,RemoteShare_0.1.13_x64.msi",
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

  validateManifestArtifactTypes(artifacts);
  assertThrows(
    () => validateManifestArtifactTypes([{ file: "RemoteShare_0.1.13.dmg" }]),
    "Release manifest artifact must have a type.",
    "missing manifest type"
  );
  assertThrows(
    () => validateManifestArtifactTypes([...artifacts, { file: "other.dmg", type: "dmg" }]),
    "Release manifest contains duplicate artifact type: dmg",
    "duplicate manifest type"
  );
  assertThrows(
    () => validateManifestArtifactTypes([...artifacts, { file: "other.msi", type: "msi" }]),
    "Release manifest contains unexpected artifact type: msi",
    "unexpected manifest type"
  );

  const manifestArtifact = validateReleaseManifestArtifact(
    {
      file: "RemoteShare_0.1.13_aarch64.dmg",
      sha256: "a".repeat(64),
      sizeBytes: 1,
      type: "dmg"
    },
    0,
    "0.1.13"
  );
  assertEqual(manifestArtifact.type, "dmg", "validated release manifest artifact type");
  assertThrows(
    () => validateReleaseManifestArtifact(null, 2, "0.1.13"),
    "Release manifest artifact 2 must be an object.",
    "non-object release manifest artifact"
  );
  assertThrows(
    () => validateReleaseManifestArtifact({ file: "RemoteShare_0.1.13_x64.msi", type: "msi" }, 1, "0.1.13"),
    "Release manifest artifact 1 has invalid type: msi.",
    "invalid release manifest artifact type"
  );
  assertThrows(
    () => validateReleaseManifestArtifact({ file: "../RemoteShare_0.1.13_aarch64.dmg", type: "dmg" }, 1, "0.1.13"),
    "Release manifest artifact 1 must use a basename-only file path.",
    "release manifest basename-only artifact"
  );
  assertThrows(
    () => validateReleaseManifestArtifact(
      { file: "RemoteShare_0.1.13_aarch64.exe", sha256: "a".repeat(64), sizeBytes: 1, type: "dmg" },
      1,
      "0.1.13"
    ),
    "Release manifest dmg artifact must use .dmg extension: RemoteShare_0.1.13_aarch64.exe.",
    "release manifest artifact extension"
  );
  assertThrows(
    () => validateReleaseManifestArtifact(
      { file: "RemoteShare_0.1.12_aarch64.dmg", sha256: "a".repeat(64), sizeBytes: 1, type: "dmg" },
      1,
      "0.1.13"
    ),
    "Release manifest dmg artifact filename must include package version 0.1.13.",
    "release manifest artifact version"
  );
  assertThrows(
    () => validateReleaseManifestArtifact(
      { file: "RemoteShare_0.1.13_aarch64.dmg", sha256: "not-a-sha256", sizeBytes: 1, type: "dmg" },
      1,
      "0.1.13"
    ),
    "Release manifest dmg artifact has invalid sha256.",
    "release manifest artifact sha256"
  );
  assertThrows(
    () => validateReleaseManifestArtifact(
      { file: "RemoteShare_0.1.13_aarch64.dmg", sha256: "a".repeat(64), sizeBytes: 0, type: "dmg" },
      1,
      "0.1.13"
    ),
    "Release manifest dmg artifact has invalid sizeBytes.",
    "release manifest artifact size"
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

function assertThrows(fn, expectedMessage, label) {
  try {
    fn();
  } catch (error) {
    assertEqual(error.message, expectedMessage, label);
    return;
  }

  throw new Error(`${label}: expected error ${expectedMessage}`);
}
