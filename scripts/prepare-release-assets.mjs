import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findEmptyInstallerArtifacts,
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  publishArtifactStatus,
  validateReleaseGeneratedAt
} from "./release-artifacts-lib.mjs";

const sourceRoot = process.argv[2] ?? "release-artifacts";
const outputRoot = process.argv[3] ?? "release-assets";
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const generatedAt = releaseGeneratedAt();

const artifacts = findInstallerArtifacts(sourceRoot);
const unexpectedArtifacts = findUnexpectedInstallerArtifacts(sourceRoot);
const emptyArtifacts = findEmptyInstallerArtifacts(artifacts);
const { duplicateTypes, missingTypes } = publishArtifactStatus(artifacts);

if (unexpectedArtifacts.length > 0) {
  throw new Error(
    `Unexpected publish installer artifact(s): ${unexpectedArtifacts
      .map((file) => path.relative(sourceRoot, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

if (missingTypes.length > 0) {
  throw new Error(
    `Missing publish artifact type(s): ${missingTypes.join(", ")} under ${sourceRoot}`
  );
}

if (emptyArtifacts.length > 0) {
  throw new Error(
    `Empty publish installer artifact(s): ${emptyArtifacts
      .map((file) => path.relative(sourceRoot, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

const basenames = new Map();
for (const artifact of artifacts) {
  const basename = path.basename(artifact.file);
  assertArtifactVersion(basename, packageVersion);
  const existing = basenames.get(basename);
  if (existing) {
    throw new Error(
      `Duplicate release asset filename: ${basename} from ${existing} and ${artifact.file}`
    );
  }
  basenames.set(basename, artifact.file);
}

if (duplicateTypes.length > 0) {
  throw new Error(
    `Expected exactly one publish artifact per type; duplicate type(s): ${duplicateTypes.join(", ")}`
  );
}

assertDistinctOutputRoot(sourceRoot, outputRoot);
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const checksumLines = [];
const manifestArtifacts = [];
for (const artifact of artifacts) {
  const basename = path.basename(artifact.file);
  const destination = path.join(outputRoot, basename);
  fs.copyFileSync(artifact.file, destination);

  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(destination))
    .digest("hex");
  checksumLines.push(`${hash}  ${basename}`);
  manifestArtifacts.push({
    file: basename,
    sha256: hash,
    sizeBytes: fs.statSync(destination).size,
    type: artifact.type
  });
}

checksumLines.sort();
fs.writeFileSync(path.join(outputRoot, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);
manifestArtifacts.sort((a, b) => a.type.localeCompare(b.type));
fs.writeFileSync(
  path.join(outputRoot, "RELEASE-MANIFEST.json"),
  `${JSON.stringify({ version: packageVersion, generatedAt, artifacts: manifestArtifacts }, null, 2)}\n`
);

console.log(checksumLines.join("\n"));
console.log(`Prepared ${artifacts.length} release asset(s) in ${outputRoot}`);

function assertDistinctOutputRoot(sourceDirectory, outputDirectory) {
  const source = path.resolve(sourceDirectory);
  const output = path.resolve(outputDirectory);
  const relative = path.relative(source, output);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(
      `Release asset output directory must be outside the source artifact directory: ${outputDirectory}`
    );
  }
}

function assertArtifactVersion(basename, version) {
  if (!basename.includes(`_${version}_`)) {
    throw new Error(
      `Release asset filename must include package version ${version}: ${basename}`
    );
  }
}

function releaseGeneratedAt() {
  const value = process.env.REMOTESHARE_RELEASE_GENERATED_AT ?? new Date().toISOString();
  try {
    validateReleaseGeneratedAt(value);
  } catch (error) {
    throw new Error(
      `REMOTESHARE_RELEASE_GENERATED_AT must be an ISO-8601 UTC timestamp with milliseconds and cannot be in the future. ${error.message}`
    );
  }

  return value;
}
