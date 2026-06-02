import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? "src-tauri/target/release/bundle";
const platform = normalizePlatform(process.argv[3] ?? process.env.RUNNER_OS ?? process.platform);
const checksumPath = path.join(root, "SHA256SUMS.txt");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const requiredExtensions = {
  macos: [".dmg"],
  windows: [".exe"],
  linux: [".deb"]
};

if (!requiredExtensions[platform]) {
  throw new Error(`Unsupported installer verification platform: ${platform}`);
}

const installerFiles = findInstallerFiles(root);
const requiredFiles = installerFiles.filter((file) =>
  requiredExtensions[platform].includes(path.extname(file))
);
const unexpectedFiles = installerFiles.filter((file) =>
  !requiredExtensions[platform].includes(path.extname(file))
);

if (requiredFiles.length === 0) {
  throw new Error(
    `No ${requiredExtensions[platform].join("/")} installer found under ${root}`
  );
}

if (unexpectedFiles.length > 0) {
  throw new Error(
    `Unexpected installer artifact(s) for ${platform}: ${unexpectedFiles
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

const emptyFiles = requiredFiles.filter((file) => fs.statSync(file).size === 0);
if (emptyFiles.length > 0) {
  throw new Error(
    `Empty installer artifact(s) for ${platform}: ${emptyFiles
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

const wrongVersionFiles = requiredFiles.filter(
  (file) => !path.basename(file).includes(`_${packageVersion}_`)
);
if (wrongVersionFiles.length > 0) {
  throw new Error(
    `Installer filename(s) for ${platform} must include package version ${packageVersion}: ${wrongVersionFiles
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

if (!fs.existsSync(checksumPath)) {
  throw new Error(`Missing checksum file: ${checksumPath}`);
}

const expectedChecksums = readChecksumFile(checksumPath);
const requiredRelativePaths = new Set(
  requiredFiles.map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
);
const staleChecksumEntries = [...expectedChecksums.keys()].filter(
  (relativePath) => !requiredRelativePaths.has(relativePath)
);
if (staleChecksumEntries.length > 0) {
  throw new Error(
    `Checksum file contains unexpected entr${staleChecksumEntries.length === 1 ? "y" : "ies"} for ${platform}: ${staleChecksumEntries.join(", ")}`
  );
}

for (const file of requiredFiles) {
  const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
  const expectedHash = expectedChecksums.get(relativePath);
  if (!expectedHash) {
    throw new Error(`Missing checksum entry for ${relativePath}`);
  }

  const actualHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch for ${relativePath}`);
  }
}

console.log(
  `Verified ${requiredFiles.length} ${platform} installer artifact(s) and checksum entries.`
);

function findInstallerFiles(directory) {
  const files = [];
  const wantedExtensions = new Set([".dmg", ".exe", ".deb"]);

  function walk(currentDirectory) {
    if (!fs.existsSync(currentDirectory)) return;

    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (wantedExtensions.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  walk(directory);
  return files.sort();
}

function readChecksumFile(file) {
  const checksums = new Map();
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/);
    if (!match) {
      throw new Error(`Invalid checksum line: ${line}`);
    }
    if (checksums.has(match[2])) {
      throw new Error(`Duplicate checksum entry: ${match[2]}`);
    }
    checksums.set(match[2], match[1]);
  }

  return checksums;
}

function normalizePlatform(value) {
  const normalized = value.toLowerCase();
  if (["macos", "darwin"].includes(normalized)) return "macos";
  if (["windows", "win32"].includes(normalized)) return "windows";
  if (["linux"].includes(normalized)) return "linux";
  return normalized;
}
