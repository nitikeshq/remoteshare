import path from "node:path";
import {
  findEmptyInstallerArtifacts,
  findInstallerArtifacts,
  findUnexpectedInstallerArtifacts,
  publishArtifactStatus,
  requiredArtifactTypes
} from "./release-artifacts-lib.mjs";

const root = process.argv[2] ?? "release-artifacts";

const artifacts = findInstallerArtifacts(root);
const unexpectedArtifacts = findUnexpectedInstallerArtifacts(root);
const emptyArtifacts = findEmptyInstallerArtifacts(artifacts);
const { duplicateTypes, missingTypes } = publishArtifactStatus(artifacts);

if (unexpectedArtifacts.length > 0) {
  throw new Error(
    `Unexpected publish installer artifact(s): ${unexpectedArtifacts
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

if (missingTypes.length > 0) {
  throw new Error(
    `Missing publish artifact type(s): ${missingTypes.join(", ")} under ${root}`
  );
}

if (emptyArtifacts.length > 0) {
  throw new Error(
    `Empty publish installer artifact(s): ${emptyArtifacts
      .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
      .join(", ")}`
  );
}

if (duplicateTypes.length > 0) {
  throw new Error(
    `Expected exactly one publish artifact per type; duplicate type(s): ${duplicateTypes.join(", ")}`
  );
}

const summary = [...requiredArtifactTypes.keys()]
  .map((type) => {
    const files = artifacts
      .filter((artifact) => artifact.type === type)
      .map((artifact) => path.relative(root, artifact.file).replaceAll(path.sep, "/"));
    return `${type}: ${files.join(", ")}`;
  })
  .join("; ");

console.log(`Verified publish artifacts for all platforms. ${summary}`);
