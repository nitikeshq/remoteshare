import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-clean-bundle-temp-"));
const cleaner = path.resolve("scripts/clean-bundle-temp.mjs");

try {
  const fixtureRoot = path.join(root, "with-temp-dmgs");
  writeFile(
    fixtureRoot,
    "src-tauri/target/release/bundle/macos/rw.123.RemoteShare_0.1.13_aarch64.dmg",
    "temporary macos dmg"
  );
  writeFile(
    fixtureRoot,
    "src-tauri/target/release/bundle/dmg/rw.456.RemoteShare_0.1.13_aarch64.dmg",
    "temporary output dmg"
  );
  writeFile(
    fixtureRoot,
    "src-tauri/target/release/bundle/dmg/RemoteShare_0.1.13_aarch64.dmg",
    "final dmg"
  );
  writeFile(
    fixtureRoot,
    "src-tauri/target/release/bundle/nsis/RemoteShare_0.1.13_x64-setup.exe",
    "final exe"
  );

  runCleaner(fixtureRoot, ["Removed 2 temporary bundle DMG files."]);
  assertMissing(
    fixtureRoot,
    "src-tauri/target/release/bundle/macos/rw.123.RemoteShare_0.1.13_aarch64.dmg"
  );
  assertMissing(
    fixtureRoot,
    "src-tauri/target/release/bundle/dmg/rw.456.RemoteShare_0.1.13_aarch64.dmg"
  );
  assertFile(
    fixtureRoot,
    "src-tauri/target/release/bundle/dmg/RemoteShare_0.1.13_aarch64.dmg",
    "final dmg"
  );
  assertFile(
    fixtureRoot,
    "src-tauri/target/release/bundle/nsis/RemoteShare_0.1.13_x64-setup.exe",
    "final exe"
  );

  const emptyRoot = path.join(root, "without-temp-dmgs");
  writeFile(
    emptyRoot,
    "src-tauri/target/release/bundle/dmg/RemoteShare_0.1.13_aarch64.dmg",
    "final dmg"
  );
  runCleaner(emptyRoot, ["No temporary bundle DMG files were removed."]);
  assertFile(
    emptyRoot,
    "src-tauri/target/release/bundle/dmg/RemoteShare_0.1.13_aarch64.dmg",
    "final dmg"
  );

  console.log("Bundle temp cleanup tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function runCleaner(directory, expectedOutput) {
  const result = spawnSync(process.execPath, [cleaner, directory], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.status !== 0) {
    throw new Error(`bundle temp cleanup expected success, got ${result.status}\n${output}`);
  }

  for (const expected of expectedOutput) {
    if (!output.includes(expected)) {
      throw new Error(`bundle temp cleanup expected output to include ${expected}\n${output}`);
    }
  }
}

function writeFile(rootDirectory, relativePath, body) {
  const file = path.join(rootDirectory, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function assertFile(rootDirectory, relativePath, expectedBody) {
  const file = path.join(rootDirectory, relativePath);
  if (fs.readFileSync(file, "utf8") !== expectedBody) {
    throw new Error(`Unexpected file body for ${relativePath}`);
  }
}

function assertMissing(rootDirectory, relativePath) {
  const file = path.join(rootDirectory, relativePath);
  if (fs.existsSync(file)) {
    throw new Error(`Expected path to be removed: ${relativePath}`);
  }
}
