import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-summary-"));
const summary = path.resolve("scripts/release-summary.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = "2026-06-01T10:00:00.000Z";

try {
  const validRoot = fixture("valid", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  runSummary(validRoot, [
    "Installer artifacts:",
    `dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    "non-empty",
    "checksum ok",
    "version ok",
    "Platform coverage:",
    "macOS DMG: present (1)",
    "Windows EXE: missing; build on Windows runner",
    "Linux DEB: missing; build on Ubuntu/Linux runner",
    "Publish readiness: incomplete (Windows EXE missing; Linux DEB missing).",
    "Checksum file:",
    "Release manifest:",
    `Release manifest generatedAt: ${generatedAt}`
  ]);

  const missingChecksumRoot = fixture(
    "missing-checksum",
    [[`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"]],
    false
  );
  runSummary(missingChecksumRoot, [
    `nsis/RemoteShare_${packageVersion}_x64-setup.exe`,
    "checksum missing",
    "Windows EXE: present (1; 1 checksum missing)",
    "Publish readiness: incomplete (macOS DMG missing; Linux DEB missing; Windows EXE checksum missing).",
    "Checksum file: missing"
  ]);

  const emptyInstallerRoot = fixture("empty-installer", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, ""]
  ]);
  runSummary(emptyInstallerRoot, [
    `dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    "0 B",
    "empty artifact",
    "macOS DMG: present (1; 1 empty)",
    "Publish readiness: incomplete (Windows EXE missing; Linux DEB missing; macOS DMG empty; release manifest invalid)."
  ]);

  const staleChecksumRoot = fixture("stale-checksum", [
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  fs.appendFileSync(
    path.join(staleChecksumRoot, "SHA256SUMS.txt"),
    `${"0".repeat(64)}  dmg/stale.dmg\n`
  );
  runSummary(staleChecksumRoot, [
    "Stale checksum entries: dmg/stale.dmg",
    "Publish readiness: incomplete (macOS DMG missing; Windows EXE missing; stale checksum dmg/stale.dmg)."
  ]);

  const invalidChecksumRoot = fixture("invalid-checksum-line", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.appendFileSync(path.join(invalidChecksumRoot, "SHA256SUMS.txt"), "not-a-checksum-line\n");
  runSummary(invalidChecksumRoot, [
    "Invalid checksum lines: not-a-checksum-line",
    "Publish readiness: incomplete (Windows EXE missing; Linux DEB missing; invalid checksum line not-a-checksum-line)."
  ]);

  const duplicateChecksumRoot = fixture("duplicate-checksum-entry", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.appendFileSync(
    path.join(duplicateChecksumRoot, "SHA256SUMS.txt"),
    `${"0".repeat(64)}  dmg/RemoteShare_${packageVersion}_aarch64.dmg\n`
  );
  runSummary(duplicateChecksumRoot, [
    `Duplicate checksum entries: dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    `Publish readiness: incomplete (Windows EXE missing; Linux DEB missing; duplicate checksum dmg/RemoteShare_${packageVersion}_aarch64.dmg).`
  ]);

  const checksumMismatchRoot = fixture("checksum-mismatch", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.writeFileSync(
    path.join(checksumMismatchRoot, `dmg/RemoteShare_${packageVersion}_aarch64.dmg`),
    "changed dmg"
  );
  runSummary(checksumMismatchRoot, [
    `dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    "checksum mismatch",
    "macOS DMG: present (1; 1 checksum mismatch)",
    "Publish readiness: incomplete (Windows EXE missing; Linux DEB missing; macOS DMG checksum mismatch; release manifest invalid)."
  ]);

  const completeRoot = fixture("complete", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.DMG`, "valid dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runSummary(completeRoot, [
    `dmg/RemoteShare_${packageVersion}_aarch64.DMG`,
    "macOS DMG: present (1)",
    "Windows EXE: present (1)",
    "Linux DEB: present (1)",
    "Publish readiness: exactly one installer per platform is present, non-empty, checksummed, version-matched, and release-manifest verified.",
    `Release manifest generatedAt: ${generatedAt}`
  ]);

  const duplicateRoot = fixture("duplicate", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    [`dmg/RemoteShare_${packageVersion}_x64.dmg`, "valid dmg 2"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runSummary(duplicateRoot, [
    "macOS DMG: present (2)",
    "Publish readiness: incomplete (macOS DMG has 2 artifacts; release manifest invalid)."
  ]);

  const wrongVersionRoot = fixture("wrong-version", [
    ["dmg/RemoteShare_9.9.9_aarch64.dmg", "wrong dmg"],
    [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
  ]);
  runSummary(wrongVersionRoot, [
    `version mismatch: expected ${packageVersion}`,
    "macOS DMG: present (1; 1 version mismatch)",
    "Publish readiness: incomplete (macOS DMG version mismatch; release manifest invalid)."
  ]);

  const unexpectedInstallerRoot = path.join(root, "unexpected-installer");
  fs.mkdirSync(unexpectedInstallerRoot, { recursive: true });
  fs.writeFileSync(
    path.join(unexpectedInstallerRoot, `RemoteShare_${packageVersion}_x64.msi`),
    "unexpected msi"
  );
  runSummary(unexpectedInstallerRoot, [
    "Installer artifacts: none found",
    `Unexpected installer artifacts: RemoteShare_${packageVersion}_x64.msi`,
    `Publish readiness: incomplete (macOS DMG missing; Windows EXE missing; Linux DEB missing; release manifest missing; unexpected installer RemoteShare_${packageVersion}_x64.msi).`,
    "Release manifest: missing"
  ]);

  const missingManifestRoot = fixture(
    "missing-manifest",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ],
    true,
    false
  );
  runSummary(missingManifestRoot, [
    "Release manifest: missing",
    "Publish readiness: incomplete (release manifest missing)."
  ]);

  const invalidManifestRoot = fixture(
    "invalid-manifest",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ]
  );
  fs.writeFileSync(path.join(invalidManifestRoot, "RELEASE-MANIFEST.json"), "{not json");
  runSummary(invalidManifestRoot, [
    "Release manifest: invalid",
    "Release manifest issue: invalid JSON:",
    "Publish readiness: incomplete (release manifest invalid)."
  ]);

  const unreadableManifestRoot = fixture(
    "unreadable-manifest",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ],
    true,
    false
  );
  fs.mkdirSync(path.join(unreadableManifestRoot, "RELEASE-MANIFEST.json"));
  runSummary(unreadableManifestRoot, [
    "Release manifest: invalid",
    "Release manifest issue: manifest read failed:",
    "Publish readiness: incomplete (release manifest invalid)."
  ]);

  const missingGeneratedAtRoot = fixture(
    "missing-generated-at",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ]
  );
  const missingGeneratedAtManifest = readManifest(missingGeneratedAtRoot);
  delete missingGeneratedAtManifest.generatedAt;
  writeManifest(missingGeneratedAtRoot, missingGeneratedAtManifest);
  runSummary(missingGeneratedAtRoot, [
    "Release manifest: invalid",
    "Release manifest issue: Release manifest generatedAt must be a valid ISO-8601 UTC timestamp.",
    "Publish readiness: incomplete (release manifest invalid)."
  ]);

  const invalidGeneratedAtRoot = fixture(
    "invalid-generated-at",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ]
  );
  const invalidGeneratedAtManifest = readManifest(invalidGeneratedAtRoot);
  invalidGeneratedAtManifest.generatedAt = "2026-06-01";
  writeManifest(invalidGeneratedAtRoot, invalidGeneratedAtManifest);
  runSummary(invalidGeneratedAtRoot, [
    "Release manifest: invalid",
    "Release manifest issue: Release manifest generatedAt must be a valid ISO-8601 UTC timestamp.",
    "Publish readiness: incomplete (release manifest invalid)."
  ]);

  const futureGeneratedAtRoot = fixture(
    "future-generated-at",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ]
  );
  const futureGeneratedAtManifest = readManifest(futureGeneratedAtRoot);
  futureGeneratedAtManifest.generatedAt = "2999-01-01T00:00:00.000Z";
  writeManifest(futureGeneratedAtRoot, futureGeneratedAtManifest);
  runSummary(futureGeneratedAtRoot, [
    "Release manifest: invalid",
    "Release manifest issue: Release manifest generatedAt cannot be in the future.",
    "Publish readiness: incomplete (release manifest invalid)."
  ]);

  const staleManifestSizeRoot = fixture(
    "stale-manifest-size",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ]
  );
  const staleManifestSize = readManifest(staleManifestSizeRoot);
  staleManifestSize.artifacts[0].sizeBytes += 1;
  writeManifest(staleManifestSizeRoot, staleManifestSize);
  runSummary(staleManifestSizeRoot, [
    "Release manifest: invalid",
    `Release manifest issue: artifact RemoteShare_${packageVersion}_aarch64.dmg size mismatch`,
    "Publish readiness: incomplete (release manifest invalid)."
  ]);

  const staleManifestHashRoot = fixture(
    "stale-manifest-hash",
    [
      [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
      [`nsis/RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
      [`deb/remoteshare_${packageVersion}_amd64.deb`, "valid deb"]
    ]
  );
  const staleManifestHash = readManifest(staleManifestHashRoot);
  staleManifestHash.artifacts[0].sha256 = sha256("stale dmg");
  writeManifest(staleManifestHashRoot, staleManifestHash);
  runSummary(staleManifestHashRoot, [
    "Release manifest: invalid",
    `Release manifest issue: artifact RemoteShare_${packageVersion}_aarch64.dmg hash mismatch`,
    "Publish readiness: incomplete (release manifest invalid)."
  ]);

  const unmanifestedInstallerRoot = fixture("unmanifested-installer", [
    [`dmg/RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"]
  ]);
  fs.writeFileSync(
    path.join(unmanifestedInstallerRoot, "RELEASE-MANIFEST.json"),
    `${JSON.stringify({ version: packageVersion, generatedAt, artifacts: [] }, null, 2)}\n`
  );
  runSummary(unmanifestedInstallerRoot, [
    `Unmanifested installer artifacts: dmg/RemoteShare_${packageVersion}_aarch64.dmg`,
    `Publish readiness: incomplete (Windows EXE missing; Linux DEB missing; unmanifested installer dmg/RemoteShare_${packageVersion}_aarch64.dmg).`
  ]);

  const emptyRoot = path.join(root, "empty");
  fs.mkdirSync(emptyRoot);
  runSummary(emptyRoot, [
    "Installer artifacts: none found",
    "macOS DMG: missing; build on macOS runner",
    "Windows EXE: missing; build on Windows runner",
    "Linux DEB: missing; build on Ubuntu/Linux runner",
    "Publish readiness: incomplete (macOS DMG missing; Windows EXE missing; Linux DEB missing; release manifest missing).",
    "Checksum file: missing",
    "Release manifest: missing"
  ]);

  console.log("Release summary tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, files, writeChecksums = true, writeManifest = true) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });

  const checksumLines = [];
  const artifacts = [];
  for (const [relativePath, body] of files) {
    const file = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    checksumLines.push(`${sha256(body)}  ${relativePath.replaceAll(path.sep, "/")}`);
    const extension = path.extname(relativePath).toLowerCase();
    const type = extension === ".dmg" ? "dmg" : extension === ".exe" ? "exe" : extension === ".deb" ? "deb" : null;
    if (type) {
      artifacts.push({
        type,
        file: path.basename(relativePath),
        sha256: sha256(body),
        sizeBytes: Buffer.byteLength(body)
      });
    }
  }

  if (writeChecksums) {
    fs.writeFileSync(path.join(directory, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);
  }
  if (writeManifest) {
    writeManifestFile(directory, { version: packageVersion, generatedAt, artifacts });
  }

  return directory;
}

function readManifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, "RELEASE-MANIFEST.json"), "utf8"));
}

function writeManifest(directory, manifest) {
  writeManifestFile(directory, manifest);
}

function writeManifestFile(directory, manifest) {
  fs.writeFileSync(
    path.join(directory, "RELEASE-MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

function runSummary(directory, expectedOutput) {
  const result = spawnSync(process.execPath, [summary, directory], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.status !== 0) {
    throw new Error(`release summary expected success, got exit ${result.status}\n${output}`);
  }

  for (const expected of expectedOutput) {
    if (!output.includes(expected)) {
      throw new Error(`release summary expected output to include ${expected}\n${output}`);
    }
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
