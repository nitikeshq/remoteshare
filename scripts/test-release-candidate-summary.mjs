import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-release-candidate-summary-"));
const generatedAt = "2026-06-01T10:00:00.000Z";

try {
  const valid = fixture("valid", {
    version: "0.1.13",
    artifacts: [
      artifact("dmg", "RemoteShare_0.1.13_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.1.13_x64-setup.exe", "windows exe"),
      artifact("deb", "RemoteShare_0.1.13_amd64.deb", "linux deb")
    ]
  });
  const output = path.join(root, "candidate.md");
  runSummary(valid, output, true, "valid summary should pass", "Prepared release candidate summary");
  const summary = fs.readFileSync(output, "utf8");
  assertIncludes(summary, "# RemoteShare Release Candidate", "summary title");
  assertIncludes(summary, "RemoteShare_0.1.13_x64-setup.exe", "windows installer row");
  assertIncludes(summary, "npm run verify:release-readiness", "readiness command");
  assertIncludes(summary, "pending pairing row `Copy` button", "pairing copy evidence");
  assertIncludes(summary, "pairing direction, visible code, typed-code state, local/remote approval, and expiry evidence", "pairing copied fields");
  assertIncludes(summary, "Trusted Device Audit", "fingerprint audit evidence");
  assertIncludes(summary, "Test date that is on or after the release manifest date and not in the future", "test date evidence");
  assertIncludes(summary, "startup health TCP ready, UDP ready, and start-at-login not failed", "startup health detail evidence");
  assertIncludes(summary, "accepted `key press r` test input", "test input evidence");
  assertIncludes(summary, "Input Transport source device and relative time", "input event context evidence");
  assertIncludes(summary, "active capture target and elapsed start time", "active capture timing evidence");
  assertIncludes(summary, "accepted mouse move, mouse click, scroll, and key events", "capture evidence");
  assertIncludes(summary, "endpoint source as discovery, reconnect, or saved endpoint", "auto endpoint source evidence");
  assertIncludes(summary, "copied endpoint label shown in the peer `This computer` row as Best LAN IPv4, LAN IPv4, or LAN IPv6", "manual copied endpoint label evidence");
  assertIncludes(summary, "endpoint source as saved endpoint or manual IP", "manual endpoint source evidence");
  assertIncludes(summary, "successful TCP 44777 probe such as Test-NetConnection", "manual TCP probe evidence");
  assertIncludes(summary, "trusted IP update `Copy` button", "trusted IP copy evidence");
  assertIncludes(summary, "device, endpoint field, current endpoint/source, last failure, and recovery hint evidence", "manual fallback recovery evidence");
  assertIncludes(summary, "Blocking issues: none", "clear blocking issue notes evidence");
  assertIncludes(summary, "screenshots or logs captured for pairing, reconnect, input, and capture evidence", "captured evidence notes");
  assertIncludes(summary, "Retest required: no", "clear retest notes evidence");
  assertIncludes(summary, "incomplete captured-evidence notes", "notes captured-evidence readiness gate");
  assertIncludes(summary, "Do not publish the draft release until both verification commands pass", "draft publish gate");

  const missingManifest = path.join(root, "missing-manifest");
  fs.mkdirSync(missingManifest, { recursive: true });
  runSummary(missingManifest, path.join(root, "missing.md"), false, "missing manifest should fail", "Missing release manifest");

  const missingDeb = fixture("missing-deb", {
    version: "0.1.13",
    artifacts: [
      artifact("dmg", "RemoteShare_0.1.13_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.1.13_x64-setup.exe", "windows exe")
    ]
  });
  runSummary(missingDeb, path.join(root, "missing-deb.md"), false, "missing deb should fail", "missing artifact type(s): deb");

  const duplicateType = fixture("duplicate-type", {
    version: "0.1.13",
    artifacts: [
      artifact("dmg", "RemoteShare_0.1.13_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.1.13_x64-setup.exe", "windows exe"),
      artifact("exe", "RemoteShare_0.1.13_arm64-setup.exe", "windows exe 2"),
      artifact("deb", "RemoteShare_0.1.13_amd64.deb", "linux deb")
    ]
  });
  runSummary(
    duplicateType,
    path.join(root, "duplicate-type.md"),
    false,
    "duplicate manifest type should fail",
    "duplicate type(s): exe"
  );

  const invalidType = fixture("invalid-type", {
    version: "0.1.13",
    artifacts: [
      artifact("dmg", "RemoteShare_0.1.13_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.1.13_x64-setup.exe", "windows exe"),
      artifact("deb", "RemoteShare_0.1.13_amd64.deb", "linux deb"),
      artifact("msi", "RemoteShare_0.1.13_x64.msi", "windows msi")
    ]
  });
  runSummary(
    invalidType,
    path.join(root, "invalid-type.md"),
    false,
    "invalid manifest type should fail",
    "invalid type: msi"
  );

  const wrongVersion = fixture("wrong-version", {
    version: "0.2.0",
    generatedAt,
    artifacts: [
      artifact("dmg", "RemoteShare_0.2.0_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.2.0_x64-setup.exe", "windows exe"),
      artifact("deb", "RemoteShare_0.2.0_amd64.deb", "linux deb")
    ]
  });
  runSummary(wrongVersion, path.join(root, "wrong-version.md"), false, "wrong version should fail", "Release manifest version must match package version");

  const futureGeneratedAt = fixture("future-generated-at", {
    version: "0.1.13",
    generatedAt: "2999-01-01T00:00:00.000Z",
    artifacts: [
      artifact("dmg", "RemoteShare_0.1.13_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.1.13_x64-setup.exe", "windows exe"),
      artifact("deb", "RemoteShare_0.1.13_amd64.deb", "linux deb")
    ]
  });
  runSummary(
    futureGeneratedAt,
    path.join(root, "future-generated-at.md"),
    false,
    "future generatedAt should fail",
    "Release manifest generatedAt cannot be in the future"
  );

  const missingFile = fixture("missing-file", {
    version: "0.1.13",
    artifacts: [
      artifact("dmg", "RemoteShare_0.1.13_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.1.13_x64-setup.exe", "windows exe", { writeFile: false }),
      artifact("deb", "RemoteShare_0.1.13_amd64.deb", "linux deb")
    ]
  });
  runSummary(missingFile, path.join(root, "missing-file.md"), false, "missing file should fail", "artifact file is missing");

  const hashMismatch = fixture("hash-mismatch", {
    version: "0.1.13",
    artifacts: [
      artifact("dmg", "RemoteShare_0.1.13_aarch64.dmg", "mac dmg"),
      artifact("exe", "RemoteShare_0.1.13_x64-setup.exe", "windows exe", { sha256: "0".repeat(64) }),
      artifact("deb", "RemoteShare_0.1.13_amd64.deb", "linux deb")
    ]
  });
  runSummary(hashMismatch, path.join(root, "hash-mismatch.md"), false, "hash mismatch should fail", "artifact hash mismatch");

  console.log("Release candidate summary tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function artifact(type, file, content, options = {}) {
  const bytes = Buffer.from(content);
  return {
    file,
    sha256: options.sha256 ?? crypto.createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: options.sizeBytes ?? bytes.length,
    type,
    testContent: content,
    writeFile: options.writeFile ?? true
  };
}

function fixture(name, manifest) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const artifacts = manifest.artifacts.map(({ testContent, writeFile, ...artifact }) => {
    if (writeFile) {
      fs.writeFileSync(path.join(directory, artifact.file), testContent);
    }
    return artifact;
  });
  fs.writeFileSync(
    path.join(directory, "RELEASE-MANIFEST.json"),
    `${JSON.stringify({ generatedAt, ...manifest, artifacts }, null, 2)}\n`
  );
  return directory;
}

function runSummary(assetsRoot, outputPath, shouldPass, label, expectedText) {
  const result = spawnSync(
    process.execPath,
    ["scripts/release-candidate-summary.mjs", assetsRoot, outputPath],
    { encoding: "utf8" }
  );
  const combined = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got ${result.status}\n${combined}`);
  }
  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure`);
  }
  assertIncludes(combined, expectedText, label);
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)} in ${JSON.stringify(value)}`);
  }
}
