import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-github-release-assets-"));
const verifier = path.resolve("scripts/verify-github-release-assets.mjs");
const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

try {
  const valid = fixture("valid");
  runVerifier(valid.releaseJson, valid.assetsRoot, true, "valid GitHub release assets should pass");

  const published = fixture("published");
  writeReleaseJson(published.releaseJson, published.assetsRoot, { isDraft: false });
  runVerifier(
    published.releaseJson,
    published.assetsRoot,
    false,
    "published release should fail before LAN smoke",
    "must stay draft"
  );

  const wrongTag = fixture("wrong-tag");
  writeReleaseJson(wrongTag.releaseJson, wrongTag.assetsRoot, { tagName: "v9.9.9" });
  runVerifier(
    wrongTag.releaseJson,
    wrongTag.assetsRoot,
    false,
    "wrong tag should fail",
    `GitHub release tag must be v${packageVersion}`
  );

  const missingExe = fixture("missing-exe");
  writeReleaseJson(missingExe.releaseJson, missingExe.assetsRoot, {
    omit: [`RemoteShare_${packageVersion}_x64-setup.exe`]
  });
  runVerifier(
    missingExe.releaseJson,
    missingExe.assetsRoot,
    false,
    "missing exe should fail",
    "GitHub release missing asset(s)"
  );

  const duplicateType = fixture("duplicate-type", {
    mutateManifest: (manifest) => ({
      ...manifest,
      artifacts: [
        manifest.artifacts[0],
        { ...manifest.artifacts[1], file: `RemoteShare_${packageVersion}_arm64-setup.exe` },
        manifest.artifacts[1],
        manifest.artifacts[2]
      ]
    })
  });
  fs.writeFileSync(path.join(duplicateType.assetsRoot, `RemoteShare_${packageVersion}_arm64-setup.exe`), "valid exe");
  writeReleaseJson(duplicateType.releaseJson, duplicateType.assetsRoot);
  runVerifier(
    duplicateType.releaseJson,
    duplicateType.assetsRoot,
    false,
    "duplicate manifest type should fail",
    "duplicate type(s): exe"
  );

  const invalidHash = fixture("invalid-hash", {
    mutateManifest: (manifest) => ({
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) =>
        artifact.type === "deb" ? { ...artifact, sha256: "not-a-sha256" } : artifact
      )
    })
  });
  writeReleaseJson(invalidHash.releaseJson, invalidHash.assetsRoot);
  runVerifier(
    invalidHash.releaseJson,
    invalidHash.assetsRoot,
    false,
    "invalid manifest hash should fail",
    "invalid sha256"
  );

  const missingGeneratedAt = fixture("missing-generated-at", {
    mutateManifest: (manifest) => {
      const { generatedAt: _generatedAt, ...withoutGeneratedAt } = manifest;
      return withoutGeneratedAt;
    }
  });
  writeReleaseJson(missingGeneratedAt.releaseJson, missingGeneratedAt.assetsRoot);
  runVerifier(
    missingGeneratedAt.releaseJson,
    missingGeneratedAt.assetsRoot,
    false,
    "missing manifest generatedAt should fail",
    "generatedAt must be a valid ISO-8601 UTC timestamp"
  );

  const staleManifestSize = fixture("stale-manifest-size", {
    mutateManifest: (manifest) => ({
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) =>
        artifact.type === "exe" ? { ...artifact, sizeBytes: artifact.sizeBytes + 1 } : artifact
      )
    })
  });
  writeReleaseJson(staleManifestSize.releaseJson, staleManifestSize.assetsRoot);
  runVerifier(
    staleManifestSize.releaseJson,
    staleManifestSize.assetsRoot,
    false,
    "stale manifest size should fail",
    "Release manifest size mismatch"
  );

  const staleManifestHash = fixture("stale-manifest-hash", {
    mutateManifest: (manifest) => ({
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) =>
        artifact.type === "dmg" ? { ...artifact, sha256: sha256("wrong dmg") } : artifact
      )
    })
  });
  writeReleaseJson(staleManifestHash.releaseJson, staleManifestHash.assetsRoot);
  runVerifier(
    staleManifestHash.releaseJson,
    staleManifestHash.assetsRoot,
    false,
    "stale manifest hash should fail",
    "Release manifest hash mismatch"
  );

  const unexpected = fixture("unexpected");
  writeReleaseJson(unexpected.releaseJson, unexpected.assetsRoot, { extra: ["RemoteShare_extra.msi"] });
  runVerifier(
    unexpected.releaseJson,
    unexpected.assetsRoot,
    false,
    "unexpected asset should fail",
    "GitHub release has unexpected asset(s)"
  );

  const sizeMismatch = fixture("size-mismatch");
  writeReleaseJson(sizeMismatch.releaseJson, sizeMismatch.assetsRoot, {
    mutate: (asset) =>
      asset.name === `RemoteShare_${packageVersion}_aarch64.dmg`
        ? { ...asset, size: asset.size + 1 }
        : asset
  });
  runVerifier(
    sizeMismatch.releaseJson,
    sizeMismatch.assetsRoot,
    false,
    "size mismatch should fail",
    "asset size mismatch"
  );

  const digestMismatch = fixture("digest-mismatch");
  writeReleaseJson(digestMismatch.releaseJson, digestMismatch.assetsRoot, {
    mutate: (asset) =>
      asset.name === `RemoteShare_${packageVersion}_amd64.deb`
        ? { ...asset, digest: `sha256:${"0".repeat(64)}` }
        : asset
  });
  runVerifier(
    digestMismatch.releaseJson,
    digestMismatch.assetsRoot,
    false,
    "digest mismatch should fail",
    "asset digest mismatch"
  );

  console.log("GitHub release asset verifier tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture(name, options = {}) {
  const assetsRoot = path.join(root, name, "release-assets");
  const releaseJson = path.join(root, name, "github-release.json");
  fs.mkdirSync(assetsRoot, { recursive: true });

  const artifacts = [
    ["dmg", `RemoteShare_${packageVersion}_aarch64.dmg`, "valid dmg"],
    ["exe", `RemoteShare_${packageVersion}_x64-setup.exe`, "valid exe"],
    ["deb", `RemoteShare_${packageVersion}_amd64.deb`, "valid deb"]
  ].map(([type, file, body]) => {
    fs.writeFileSync(path.join(assetsRoot, file), body);
    return {
      file,
      sha256: sha256(body),
      sizeBytes: Buffer.byteLength(body),
      type
    };
  });

  fs.writeFileSync(
    path.join(assetsRoot, "SHA256SUMS.txt"),
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`).sort().join("\n")}\n`
  );
  fs.writeFileSync(
    path.join(assetsRoot, "RELEASE-MANIFEST.json"),
    `${JSON.stringify(
      options.mutateManifest?.({
        version: packageVersion,
        generatedAt: "2026-06-01T10:00:00.000Z",
        artifacts
      }) ?? {
        version: packageVersion,
        generatedAt: "2026-06-01T10:00:00.000Z",
        artifacts
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(path.join(assetsRoot, "lan-smoke-report.md"), "# LAN smoke report\n");
  fs.writeFileSync(path.join(assetsRoot, "release-candidate-summary.md"), "# Release candidate\n");
  writeReleaseJson(releaseJson, assetsRoot);

  return { assetsRoot, releaseJson };
}

function writeReleaseJson(file, assetsRoot, options = {}) {
  const omit = new Set(options.omit ?? []);
  const extra = options.extra ?? [];
  const assetNames = [
    ...JSON.parse(fs.readFileSync(path.join(assetsRoot, "RELEASE-MANIFEST.json"), "utf8")).artifacts.map(
      (artifact) => artifact.file
    ),
    "SHA256SUMS.txt",
    "RELEASE-MANIFEST.json",
    "lan-smoke-report.md",
    "release-candidate-summary.md",
    ...extra
  ].filter((name) => !omit.has(name));

  const assets = assetNames.map((name) => {
    const localPath = path.join(assetsRoot, name);
    const body = fs.existsSync(localPath) ? fs.readFileSync(localPath) : Buffer.from("extra");
    return {
      name,
      size: body.byteLength,
      digest: `sha256:${sha256(body)}`
    };
  });

  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        tagName: options.tagName ?? `v${packageVersion}`,
        isDraft: options.isDraft ?? true,
        assets: options.mutate ? assets.map(options.mutate) : assets
      },
      null,
      2
    )}\n`
  );
}

function runVerifier(releaseJson, assetsRoot, shouldPass, label, expectedOutput = "") {
  const result = spawnSync(process.execPath, [verifier, releaseJson, assetsRoot], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  if (expectedOutput && !output.includes(expectedOutput)) {
    throw new Error(`${label}: expected output to include ${expectedOutput}\n${output}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
