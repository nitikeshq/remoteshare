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

export function validateManifestArtifactTypes(artifacts) {
  const seenTypes = new Set();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || typeof artifact.type !== "string") {
      throw new Error("Release manifest artifact must have a type.");
    }
    if (!requiredArtifactTypes.has(artifact.type)) {
      throw new Error(`Release manifest contains unexpected artifact type: ${artifact.type}`);
    }
    if (seenTypes.has(artifact.type)) {
      throw new Error(`Release manifest contains duplicate artifact type: ${artifact.type}`);
    }
    seenTypes.add(artifact.type);
  }
}

export function validateReleaseManifestArtifact(artifact, index, packageVersion) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`Release manifest artifact ${index} must be an object.`);
  }

  const { file, sha256, sizeBytes, type } = artifact;
  if (typeof type !== "string" || !requiredArtifactTypes.has(type)) {
    throw new Error(`Release manifest artifact ${index} has invalid type: ${String(type)}.`);
  }

  if (typeof file !== "string" || file.length === 0 || path.basename(file) !== file) {
    throw new Error(`Release manifest artifact ${index} must use a basename-only file path.`);
  }

  const expectedExtension = requiredArtifactTypes.get(type);
  if (path.extname(file).toLowerCase() !== expectedExtension) {
    throw new Error(
      `Release manifest ${type} artifact must use ${expectedExtension} extension: ${file}.`
    );
  }

  if (!file.includes(`_${packageVersion}_`)) {
    throw new Error(
      `Release manifest ${type} artifact filename must include package version ${packageVersion}.`
    );
  }

  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`Release manifest ${type} artifact has invalid sha256.`);
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Release manifest ${type} artifact has invalid sizeBytes.`);
  }

  return { file, sha256, sizeBytes, type };
}

export function isValidReleaseGeneratedAt(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value
  );
}

export function validateReleaseGeneratedAt(value) {
  if (!isValidReleaseGeneratedAt(value)) {
    throw new Error("Release manifest generatedAt must be a valid ISO-8601 UTC timestamp.");
  }
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
