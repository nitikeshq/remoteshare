import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const bundleRoot = path.join(root, "src-tauri", "target", "release", "bundle");
const targets = [
  path.join(bundleRoot, "dmg"),
  path.join(bundleRoot, "macos")
];

let removed = 0;
for (const directory of targets) {
  if (!fs.existsSync(directory)) {
    console.log(`skip: ${directory} does not exist`);
    continue;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^rw\..+\.dmg$/.test(entry.name)) {
      continue;
    }

    const file = path.join(directory, entry.name);
    fs.rmSync(file, { force: true });
    removed += 1;
    console.log(`removed: ${file}`);
  }
}

console.log(
  removed === 0
    ? "No temporary bundle DMG files were removed."
    : `Removed ${removed} temporary bundle DMG file${removed === 1 ? "" : "s"}.`
);
