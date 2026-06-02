import fs from "node:fs";
import path from "node:path";

export const requiredArtifactTypes = new Map([
  ["dmg", ".dmg"],
  ["exe", ".exe"],
  ["deb", ".deb"]
]);

const unexpectedInstallerExtensions = new Set([".appimage", ".msi", ".pkg", ".rpm"]);

export function findInstallerArtifacts(directory) {
  const artifacts = [];
  const wantedExtensions = new Map(
    [...requiredArtifactTypes].map(([type, extension]) => [extension, type])
  );

  walkFiles(directory, (file) => {
    const type = wantedExtensions.get(path.extname(file).toLowerCase());
    if (type) {
      artifacts.push({ file, type });
    }
  });

  return artifacts.sort((a, b) => a.file.localeCompare(b.file));
}

export function findUnexpectedInstallerArtifacts(directory) {
  const artifacts = [];

  walkFiles(directory, (file) => {
    const lowerName = path.basename(file).toLowerCase();
    const extension = path.extname(lowerName);
    if (unexpectedInstallerExtensions.has(extension) || lowerName.endsWith(".appimage")) {
      artifacts.push(file);
    }
  });

  return artifacts.sort();
}

export function findEmptyInstallerArtifacts(artifacts) {
  return artifacts
    .filter((artifact) => fs.statSync(artifact.file).size === 0)
    .map((artifact) => artifact.file)
    .sort();
}

export function publishArtifactStatus(artifacts) {
  const presentTypes = new Set(artifacts.map((artifact) => artifact.type));
  const missingTypes = [...requiredArtifactTypes.keys()].filter(
    (type) => !presentTypes.has(type)
  );
  const duplicateTypes = [...requiredArtifactTypes.keys()].filter(
    (type) => artifacts.filter((artifact) => artifact.type === type).length > 1
  );

  return { duplicateTypes, missingTypes };
}

function walkFiles(directory, visit) {
  function walk(currentDirectory) {
    if (!fs.existsSync(currentDirectory)) return;

    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        visit(fullPath);
      }
    }
  }

  walk(directory);
}
