import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-clean-debug-cache-"));
const cleaner = path.resolve("scripts/clean-debug-cache.mjs");

try {
  const fixtureRoot = path.join(root, "with-cache");
  writeFile(fixtureRoot, "src-tauri/target/debug/build/build-script-cache", "build");
  writeFile(fixtureRoot, "src-tauri/target/debug/deps/libcache.rmeta", "deps");
  writeFile(fixtureRoot, "src-tauri/target/debug/incremental/cache/state", "incremental");
  writeFile(fixtureRoot, "src-tauri/target/release/bundle/dmg/RemoteShare.dmg", "release dmg");

  runCleaner(fixtureRoot, [
    "removed:",
    "Rust debug cache removed. Release bundle artifacts were left untouched."
  ]);
  assertMissing(fixtureRoot, "src-tauri/target/debug/build");
  assertMissing(fixtureRoot, "src-tauri/target/debug/deps");
  assertMissing(fixtureRoot, "src-tauri/target/debug/incremental");
  assertFile(fixtureRoot, "src-tauri/target/release/bundle/dmg/RemoteShare.dmg", "release dmg");

  const emptyRoot = path.join(root, "without-cache");
  writeFile(emptyRoot, "src-tauri/target/release/bundle/dmg/RemoteShare.dmg", "release dmg");
  runCleaner(emptyRoot, ["No Rust debug cache directories were removed."]);
  assertFile(emptyRoot, "src-tauri/target/release/bundle/dmg/RemoteShare.dmg", "release dmg");

  console.log("Debug cache cleanup tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function runCleaner(directory, expectedOutput) {
  const result = spawnSync(process.execPath, [cleaner, directory], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.status !== 0) {
    throw new Error(`debug cache cleanup expected success, got ${result.status}\n${output}`);
  }

  for (const expected of expectedOutput) {
    if (!output.includes(expected)) {
      throw new Error(`debug cache cleanup expected output to include ${expected}\n${output}`);
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
