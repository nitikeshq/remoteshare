import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const targets = [
  path.join(root, "src-tauri", "target", "debug", "build"),
  path.join(root, "src-tauri", "target", "debug", "deps"),
  path.join(root, "src-tauri", "target", "debug", "incremental")
];

let removed = 0;
for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.log(`skip: ${target} does not exist`);
    continue;
  }

  fs.rmSync(target, { recursive: true, force: true });
  removed += 1;
  console.log(`removed: ${target}`);
}

console.log(
  removed === 0
    ? "No Rust debug cache directories were removed."
    : "Rust debug cache removed. Release bundle artifacts were left untouched."
);
