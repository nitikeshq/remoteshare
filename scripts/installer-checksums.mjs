import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? "src-tauri/target/release/bundle";
const wantedExtensions = new Set([".dmg", ".exe", ".deb"]);
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const files = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (wantedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
}

walk(root);
files.sort();

if (files.length === 0) {
  throw new Error(`No installer files found under ${root}`);
}

const emptyFiles = files.filter((file) => fs.statSync(file).size === 0);
if (emptyFiles.length > 0) {
  throw new Error(
    `Empty installer artifact(s): ${emptyFiles
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

const wrongVersionFiles = files.filter(
  (file) => !path.basename(file).includes(`_${packageVersion}_`)
);
if (wrongVersionFiles.length > 0) {
  throw new Error(
    `Installer filename(s) must include package version ${packageVersion}: ${wrongVersionFiles
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

const lines = files.map((file) => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
  return `${hash}  ${relativePath}`;
});

const outputPath = path.join(root, "SHA256SUMS.txt");
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
console.log(`Wrote ${outputPath}`);
