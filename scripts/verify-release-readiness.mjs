import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const releaseAssetsRoot = process.argv[2];
const lanSmokeReportPath = process.argv[3];

if (!releaseAssetsRoot || !lanSmokeReportPath) {
  throw new Error(
    "Usage: node scripts/verify-release-readiness.mjs <release-assets-dir> <lan-smoke-report.md>"
  );
}

runCheck("release manifest", "scripts/verify-release-manifest.mjs", [releaseAssetsRoot]);
verifyPrefilledLanSmokeReport(releaseAssetsRoot);
verifyReleaseCandidateSummary(releaseAssetsRoot);
runCheck("LAN smoke report", "scripts/verify-lan-smoke-report.mjs", [lanSmokeReportPath]);
verifySmokeReportMatchesReleaseAssets(releaseAssetsRoot, lanSmokeReportPath);

console.log(
  `Verified release readiness for ${path.relative(process.cwd(), releaseAssetsRoot)} and ${path.relative(process.cwd(), lanSmokeReportPath)}`
);

function runCheck(label, script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`Release readiness ${label} check failed.\n${output}`);
  }
}

function verifyReleaseCandidateSummary(assetsRoot) {
  const summaryPath = path.join(assetsRoot, "release-candidate-summary.md");
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Missing release candidate summary: ${summaryPath}`);
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-readiness-summary-"));
  const expectedSummaryPath = path.join(tempDirectory, "release-candidate-summary.md");
  try {
    runCheck("release candidate summary", "scripts/release-candidate-summary.mjs", [
      assetsRoot,
      expectedSummaryPath
    ]);

    const actual = fs.readFileSync(summaryPath, "utf8");
    const expected = fs.readFileSync(expectedSummaryPath, "utf8");
    if (actual !== expected) {
      throw new Error("Release candidate summary must match release assets and manifest.");
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function verifyPrefilledLanSmokeReport(assetsRoot) {
  const reportPath = path.join(assetsRoot, "lan-smoke-report.md");
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Missing prefilled LAN smoke report: ${reportPath}`);
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-readiness-smoke-"));
  const expectedReportPath = path.join(tempDirectory, "lan-smoke-report.md");
  try {
    runCheck("prefilled LAN smoke report", "scripts/prepare-lan-smoke-report.mjs", [
      assetsRoot,
      expectedReportPath
    ]);

    const actual = fs.readFileSync(reportPath, "utf8");
    const expected = fs.readFileSync(expectedReportPath, "utf8");
    if (actual !== expected) {
      throw new Error("Prefilled LAN smoke report must match release assets, manifest, and template.");
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function verifySmokeReportMatchesReleaseAssets(assetsRoot, smokeReportPath) {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(assetsRoot, "RELEASE-MANIFEST.json"), "utf8")
  );
  const artifactsByType = new Map(
    manifest.artifacts.map((artifact) => [artifact.type, artifact.file])
  );
  const context = parseTable(fs.readFileSync(smokeReportPath, "utf8"), "Test Context");

  assertSmokeVersionMatches(context, packageJson.version);
  for (const artifact of manifest.artifacts) {
    if (!artifact.file.includes(packageJson.version)) {
      throw new Error(
        `Release artifact filename must include package version ${packageJson.version}: ${artifact.file}`
      );
    }
  }

  assertSmokeInstallerMatches(context, artifactsByType, "macOS installer file", "dmg");
  assertSmokeInstallerMatches(context, artifactsByType, "Windows installer file", "exe");
  assertSmokeInstallerMatches(context, artifactsByType, "Linux installer file", "deb");
  assertSmokeChecksumMatches(context, manifest.artifacts, "macOS installer SHA256", "dmg");
  assertSmokeChecksumMatches(context, manifest.artifacts, "Windows installer SHA256", "exe");
  assertSmokeChecksumMatches(context, manifest.artifacts, "Linux installer SHA256", "deb");
}

function assertSmokeVersionMatches(context, expectedVersion) {
  const reportVersion = context.get("RemoteShare version/tag") ?? "";
  if (!reportVersion.includes(expectedVersion)) {
    throw new Error(
      `LAN smoke report RemoteShare version/tag must include package version ${expectedVersion}: got ${reportVersion || "<missing>"}`
    );
  }
}

function assertSmokeInstallerMatches(context, artifactsByType, field, type) {
  const reportFile = path.basename(context.get(field) ?? "");
  const manifestFile = artifactsByType.get(type);
  if (reportFile !== manifestFile) {
    throw new Error(
      `LAN smoke report ${field} must match release ${type} artifact: expected ${manifestFile}, got ${reportFile || "<missing>"}`
    );
  }
}

function assertSmokeChecksumMatches(context, artifacts, field, type) {
  const reportHash = (context.get(field) ?? "").toLowerCase();
  const artifact = artifacts.find((candidate) => candidate.type === type);
  if (reportHash !== artifact?.sha256) {
    throw new Error(
      `LAN smoke report ${field} must match release ${type} sha256: expected ${artifact?.sha256 ?? "<missing>"}, got ${reportHash || "<missing>"}`
    );
  }
}

function parseTable(markdown, sectionName) {
  const lines = markdown.split(/\r?\n/);
  let inSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+)$/);
    if (heading) {
      inSection = heading[1].trim() === sectionName;
      continue;
    }

    if (!inSection || !lines[index].startsWith("|")) continue;
    const header = cells(lines[index]);
    const separator = lines[index + 1] ? cells(lines[index + 1]) : [];
    if (header.length < 2 || !separator.every((cell) => /^-+$/.test(cell))) continue;

    const rows = new Map();
    index += 2;
    while (index < lines.length && lines[index].startsWith("|")) {
      const row = cells(lines[index]);
      if (row.length >= 2) rows.set(row[0], row[1]);
      index += 1;
    }
    return rows;
  }

  throw new Error(`Missing smoke report section: ${sectionName}`);
}

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
