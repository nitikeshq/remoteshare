import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const workflowPath = ".github/workflows/release-builds.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const licenseText = fs.readFileSync("LICENSE", "utf8");
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const networkingMilestone = fs.readFileSync("docs/networking-milestone.md", "utf8");
const architecture = fs.readFileSync("docs/architecture.md", "utf8");
const firstLanTest = fs.readFileSync("docs/first-lan-test.md", "utf8");
const lanSmokeReport = fs.readFileSync("docs/lan-smoke-report-template.md", "utf8");
const releaseChecklist = fs.readFileSync("docs/release-checklist.md", "utf8");
const transportRoadmap = fs.readFileSync("docs/transport-roadmap.md", "utf8");
const installerVerifierPath = "scripts/verify-installer-artifacts.mjs";
const installerVerifier = fs.readFileSync(installerVerifierPath, "utf8");
const installerChecksums = fs.readFileSync("scripts/installer-checksums.mjs", "utf8");
const publishArtifactVerifierPath = "scripts/verify-publish-artifacts.mjs";
const publishArtifactVerifier = fs.readFileSync(publishArtifactVerifierPath, "utf8");
const releaseAssetPreparerPath = "scripts/prepare-release-assets.mjs";
const releaseAssetPreparer = fs.readFileSync(releaseAssetPreparerPath, "utf8");
const releaseManifestVerifierPath = "scripts/verify-release-manifest.mjs";
const releaseManifestVerifier = fs.readFileSync(releaseManifestVerifierPath, "utf8");
const releaseArtifactsLibPath = "scripts/release-artifacts-lib.mjs";
const releaseArtifactsLib = fs.readFileSync(releaseArtifactsLibPath, "utf8");
const releaseSummary = fs.readFileSync("scripts/release-summary.mjs", "utf8");
const lanSmokeVerifierPath = "scripts/verify-lan-smoke-report.mjs";
const lanSmokeVerifier = fs.readFileSync(lanSmokeVerifierPath, "utf8");
const releaseReadinessVerifierPath = "scripts/verify-release-readiness.mjs";
const releaseReadinessVerifier = fs.readFileSync(releaseReadinessVerifierPath, "utf8");
const githubReleaseAssetVerifierPath = "scripts/verify-github-release-assets.mjs";
const githubReleaseAssetVerifier = fs.readFileSync(githubReleaseAssetVerifierPath, "utf8");
const releaseAssetDownloaderPath = "scripts/download-release-assets.mjs";
const releaseAssetDownloader = fs.readFileSync(releaseAssetDownloaderPath, "utf8");
const releaseAssetDownloaderTestPath = "scripts/test-download-release-assets.mjs";
const releaseAssetDownloaderTest = fs.readFileSync(releaseAssetDownloaderTestPath, "utf8");
const lanSmokePreparerPath = "scripts/prepare-lan-smoke-report.mjs";
const lanSmokePreparer = fs.readFileSync(lanSmokePreparerPath, "utf8");
const smokeReportRowsPath = "scripts/smoke-report-release-rows.mjs";
const smokeReportRows = fs.readFileSync(smokeReportRowsPath, "utf8");
const releaseCandidateSummaryPath = "scripts/release-candidate-summary.mjs";
const releaseCandidateSummary = fs.readFileSync(releaseCandidateSummaryPath, "utf8");
const cleanDebugCache = fs.readFileSync("scripts/clean-debug-cache.mjs", "utf8");
const cleanBundleTemp = fs.readFileSync("scripts/clean-bundle-temp.mjs", "utf8");
const rustfmtCheckerPath = "scripts/check-rustfmt.mjs";
const rustfmtChecker = fs.readFileSync(rustfmtCheckerPath, "utf8");
const rustfmtCheckerTestPath = "scripts/test-rustfmt-check.mjs";
const rustfmtCheckerTest = fs.readFileSync(rustfmtCheckerTestPath, "utf8");
const ciAnnotationHelperPath = "scripts/ci-run-with-annotation.mjs";
const ciAnnotationHelper = fs.readFileSync(ciAnnotationHelperPath, "utf8");
const ciAnnotationHelperTestPath = "scripts/test-ci-run-with-annotation.mjs";
const ciAnnotationHelperTest = fs.readFileSync(ciAnnotationHelperTestPath, "utf8");
const cryptoRuntime = fs.readFileSync("src-tauri/src/crypto.rs", "utf8");
const identityRuntime = fs.readFileSync("src-tauri/src/identity.rs", "utf8");
const networkRuntime = fs.readFileSync("src-tauri/src/network.rs", "utf8");
const runtimeStore = fs.readFileSync("src-tauri/src/runtime.rs", "utf8");
const inputRuntime = fs.readFileSync("src-tauri/src/input.rs", "utf8");
const reconnectAttemptCalls = networkRuntime.match(/record_reconnect_attempt\(\)/g)?.length ?? 0;
const autostartRuntime = fs.readFileSync("src-tauri/src/autostart.rs", "utf8");
const tauriAppRuntime = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const appUi = fs.readFileSync("src/main.tsx", "utf8");
const bundleRoot = "src-tauri/target/release/bundle";
const expectedTargets = ["dmg", "nsis", "deb"];
const expectedScripts = [
  "build",
  "clean:debug-cache",
  "test:clean-debug-cache",
  "clean:bundle-temp",
  "test:clean-bundle-temp",
  "typecheck",
  "check:rust",
  "test:rust",
  "check:rustfmt",
  "test:rustfmt",
  "test:ci-annotation",
  "checksums:installers",
  "test:checksums",
  "verify:installers",
  "test:installers",
  "verify:publish-artifacts",
  "test:publish-artifacts",
  "prepare:release-assets",
  "test:release-assets",
  "verify:release-manifest",
  "test:release-manifest",
  "test:release-artifacts-lib",
  "check:disk",
  "test:disk",
  "test:release-summary",
  "verify:lan-smoke-report",
  "test:lan-smoke-report",
  "prepare:lan-smoke-report",
  "test:prepare-lan-smoke-report",
  "release:smoke-rows",
  "test:smoke-rows",
  "release:candidate-summary",
  "test:release-candidate-summary",
  "verify:release-readiness",
  "test:release-readiness",
  "verify:github-release-assets",
  "test:github-release-assets",
  "download:release-assets",
  "test:download-release-assets",
  "release:summary",
  "verify:release-scripts",
  "verify:release"
];
const checks = [];

check("Tauri bundling is active", tauriConfig.bundle?.active === true);
check(
  "Tauri targets include dmg, nsis, and deb",
  sameSet(tauriConfig.bundle?.targets ?? [], expectedTargets)
);
check(
  "Windows NSIS uses current-user install mode",
  tauriConfig.bundle?.windows?.nsis?.installMode === "currentUser"
);
check("macOS bundle target is configured", workflow.includes("macos-latest"));
check("Windows bundle target is configured", workflow.includes("windows-latest"));
check("Linux bundle target is configured", workflow.includes("ubuntu-latest"));
check("Release workflow bounds native build duration", workflow.includes("timeout-minutes: 60"));
check("Release workflow bounds release assembly duration", countOccurrences(workflow, "timeout-minutes: 20") >= 2);
check("Project metadata uses the public repository URL", packageJson.repository?.url === "git+https://github.com/nitikeshq/remoteshare.git" && packageJson.homepage === "https://github.com/nitikeshq/remoteshare#readme" && cargoToml.includes('repository = "https://github.com/nitikeshq/remoteshare"'));
check("Project declares MIT license", packageJson.license === "MIT" && cargoToml.includes('license = "MIT"') && readme.includes("[MIT License](LICENSE)") && licenseText.includes("MIT License") && licenseText.includes("RemoteShare contributors"));
check("Release workflow uses matrix artifact paths", workflow.includes("${{ matrix.artifact-path }}"));
check("Release workflow uploads macOS DMG artifacts", workflow.includes("src-tauri/target/release/bundle/dmg/*.dmg"));
check("Release workflow uploads Windows EXE artifacts", workflow.includes("src-tauri/target/release/bundle/nsis/*.exe"));
check("Release workflow uploads Linux DEB artifacts", workflow.includes("src-tauri/target/release/bundle/deb/*.deb"));
check("Release workflow runs checksum generation", workflow.includes("npm run checksums:installers"));
check("Release workflow verifies installer checksums", workflow.includes("npm run verify:installers"));
check("Release workflow prints artifact summary", workflow.includes("npm run release:summary"));
check("Release workflow runs disk preflight", workflow.includes("npm run check:disk"));
check("Release workflow tests disk preflight", workflow.includes("npm run test:disk"));
check("Release workflow runs checksum generation tests", workflow.includes("npm run test:checksums"));
check("Release workflow runs installer verifier tests", workflow.includes("npm run test:installers"));
check("Release workflow runs publish artifact verifier tests", workflow.includes("npm run test:publish-artifacts"));
check("Release workflow runs release asset preparation tests", workflow.includes("npm run test:release-assets"));
check("Release workflow runs release manifest verifier tests", workflow.includes("npm run test:release-manifest"));
check("Release workflow runs release artifact helper tests", workflow.includes("npm run test:release-artifacts-lib"));
check("Release workflow runs debug cache cleanup tests", workflow.includes("npm run test:clean-debug-cache"));
check("Release workflow runs bundle temp cleanup tests", workflow.includes("npm run test:clean-bundle-temp"));
check("Release workflow runs release summary tests", workflow.includes("npm run test:release-summary"));
check("Release workflow runs LAN smoke report verifier tests", workflow.includes("npm run test:lan-smoke-report"));
check("Release workflow runs LAN smoke report preparation tests", workflow.includes("npm run test:prepare-lan-smoke-report"));
check("Release workflow runs smoke report release row tests", workflow.includes("npm run test:smoke-rows"));
check("Release workflow runs release readiness verifier tests", workflow.includes("npm run test:release-readiness"));
check("Release workflow runs GitHub release asset verifier tests", workflow.includes("npm run test:github-release-assets"));
check("Release workflow runs release asset download helper tests", workflow.includes("npm run test:download-release-assets"));
check("Release workflow runs Rust formatter diagnostic tests", workflow.includes("npm run test:rustfmt"));
check("Release workflow runs CI annotation helper tests", workflow.includes("npm run test:ci-annotation"));
check("Release workflow runs package doctor", workflow.includes("npm run doctor"));
check("Release workflow runs Rust unit tests before native build", workflow.indexOf("ci-run-with-annotation.mjs \"Rust check\"") < workflow.indexOf("ci-run-with-annotation.mjs \"Rust tests\"") && workflow.indexOf("ci-run-with-annotation.mjs \"Rust tests\"") < workflow.indexOf("npm run clean:debug-cache") && workflow.indexOf("ci-run-with-annotation.mjs \"Rust tests\"") < workflow.indexOf("npm run build"));
check("Release workflow annotates Rust check and test failures", workflow.includes("ci-run-with-annotation.mjs \"Rust check\"") && workflow.includes("ci-run-with-annotation.mjs \"Rust tests\""));
check("Release workflow cleans debug cache before native build", workflow.indexOf("ci-run-with-annotation.mjs \"Rust tests\"") < workflow.indexOf("npm run clean:debug-cache") && workflow.indexOf("npm run clean:debug-cache") < workflow.indexOf("npm run build"));
check("Release workflow cleans bundle temp files before native build", workflow.indexOf("npm run clean:debug-cache") < workflow.indexOf("npm run clean:bundle-temp") && workflow.indexOf("npm run clean:bundle-temp") < workflow.indexOf("npm run build"));
check("Local native build cleans bundle temp files before Tauri build", packageJson.scripts?.build?.startsWith("npm run clean:bundle-temp && ") && packageJson.scripts.build.includes("tauri build"));
check("Release workflow publishes GitHub releases for tags", workflow.includes("Publish GitHub Release") && workflow.includes("softprops/action-gh-release@v2"));
check("Release workflow grants publish permission", /permissions:\r?\n\s+contents:\s*write/.test(workflow));
check("Release publish job checks out scripts before npm commands", publishJobIncludesBefore("uses: actions/checkout@v4", "npm run verify:publish-artifacts"));
check("Release publish job sets up Node before npm commands", publishJobIncludesBefore("uses: actions/setup-node@v4", "npm run verify:publish-artifacts") && publishJobIncludesBefore("node-version: \"24\"", "npm run verify:publish-artifacts"));
check("Release publish job installs npm dependencies before npm commands", publishJobIncludesBefore("run: npm ci", "npm run verify:publish-artifacts"));
check("Release workflow verifies all platform artifacts before publish", workflow.indexOf("Verify all platform artifacts") < workflow.indexOf("Generate combined checksums") && workflow.includes("npm run verify:publish-artifacts -- release-artifacts"));
check("Release workflow generates combined release checksums", workflow.includes("Generate combined checksums") && workflow.includes("npm run prepare:release-assets -- release-artifacts release-assets"));
check("Release workflow verifies release manifest before publish", workflow.indexOf("Generate combined checksums") < workflow.indexOf("Verify release manifest") && workflow.indexOf("Verify release manifest") < workflow.indexOf("Attach installers to release") && workflow.includes("npm run verify:release-manifest -- release-assets"));
check("Release workflow prepares LAN smoke report before publish", workflow.indexOf("Verify release manifest") < workflow.indexOf("Prepare LAN smoke report") && workflow.indexOf("Prepare LAN smoke report") < workflow.indexOf("Attach installers to release") && workflow.includes("npm run prepare:lan-smoke-report -- release-assets release-assets/lan-smoke-report.md"));
check("Release workflow prepares release candidate summary before publish", workflow.indexOf("Prepare LAN smoke report") < workflow.indexOf("Prepare release candidate summary") && workflow.indexOf("Prepare release candidate summary") < workflow.indexOf("Attach installers to release") && workflow.includes("npm run release:candidate-summary -- release-assets release-assets/release-candidate-summary.md"));
check("Release workflow creates tagged releases as drafts", workflow.includes("draft: true") && readme.includes("draft GitHub Release") && releaseChecklist.includes("creates a draft GitHub Release") && releaseChecklist.includes("Keep the release as a draft until `npm run verify:release-readiness"));
check("Release workflow publishes release candidate summary to job summary", workflow.includes("cat release-assets/release-candidate-summary.md >> \"$GITHUB_STEP_SUMMARY\"") && publishJobIncludesBefore("npm run release:candidate-summary -- release-assets release-assets/release-candidate-summary.md", "cat release-assets/release-candidate-summary.md >> \"$GITHUB_STEP_SUMMARY\"") && publishJobIncludesBefore("cat release-assets/release-candidate-summary.md >> \"$GITHUB_STEP_SUMMARY\"", "Attach installers to release"));
check("Release workflow prints LAN smoke report rows before publish", workflow.indexOf("Prepare LAN smoke report") < workflow.indexOf("Print LAN smoke report installer rows") && workflow.indexOf("Print LAN smoke report installer rows") < workflow.indexOf("Attach installers to release") && workflow.includes("npm run release:smoke-rows -- release-assets"));
check("Release workflow publishes flat release assets", workflow.includes("release-assets/*.dmg") && workflow.includes("release-assets/*.exe") && workflow.includes("release-assets/*.deb") && workflow.includes("release-assets/SHA256SUMS.txt") && workflow.includes("release-assets/RELEASE-MANIFEST.json"));
check("Release workflow attaches LAN smoke report", workflow.includes("release-assets/lan-smoke-report.md"));
check("Release workflow attaches release candidate summary", workflow.includes("release-assets/release-candidate-summary.md"));
check("Release workflow verifies uploaded GitHub release assets", workflow.includes("gh release view \"${GITHUB_REF_NAME}\" --json tagName,isDraft,assets > github-release.json") && workflow.includes("npm run verify:github-release-assets -- github-release.json release-assets"));
check("Release workflow assembles release assets for manual runs", workflow.includes("name: Assemble Release Assets") && workflow.includes("if: github.event_name == 'workflow_dispatch'") && workflow.includes("name: remoteshare-release-assets"));
check("Manual release asset assembly verifies before upload", assembleJobIncludesBefore("npm run verify:publish-artifacts -- release-artifacts", "npm run prepare:release-assets -- release-artifacts release-assets") && assembleJobIncludesBefore("npm run prepare:release-assets -- release-artifacts release-assets", "npm run verify:release-manifest -- release-assets") && assembleJobIncludesBefore("npm run verify:release-manifest -- release-assets", "npm run prepare:lan-smoke-report -- release-assets release-assets/lan-smoke-report.md") && assembleJobIncludesBefore("npm run prepare:lan-smoke-report -- release-assets release-assets/lan-smoke-report.md", "npm run release:candidate-summary -- release-assets release-assets/release-candidate-summary.md") && assembleJobIncludesBefore("npm run release:candidate-summary -- release-assets release-assets/release-candidate-summary.md", "cat release-assets/release-candidate-summary.md >> \"$GITHUB_STEP_SUMMARY\"") && assembleJobIncludesBefore("cat release-assets/release-candidate-summary.md >> \"$GITHUB_STEP_SUMMARY\"", "npm run release:smoke-rows -- release-assets") && assembleJobIncludesBefore("npm run release:smoke-rows -- release-assets", "name: remoteshare-release-assets"));
check("Release workflow does not mask macOS build failures", !workflow.includes("Build macOS app with DMG fallback"));
check("README documents npm ci setup", readme.includes("npm ci"));
check("README documents common verification commands", readme.includes("npm run typecheck") && readme.includes("npm run doctor") && readme.includes("npm run test:rust") && readme.includes("npm run verify:release"));
check("README documents debug cache cleanup", readme.includes("npm run clean:debug-cache"));
check("README leads with LAN MVP scope", readme.includes("sharing one keyboard and mouse") && readme.includes("main computer: macOS") && readme.includes("client computer: Windows"));
check("README documents future role selection", readme.includes("Main, Client, or Both") && readme.includes("any trusted computer become the main keyboard/mouse source"));
check("README documents current status", readme.includes("not production-ready yet") && readme.includes("LAN MVP in progress"));
check("README documents firewall ports", readme.includes("TCP `44777`") && readme.includes("UDP `44778`"));
check("README documents manual endpoint fallback", readme.includes("If discovery fails") && readme.includes("manual pairing"));
check("README documents native installer paths", readme.includes("src-tauri/target/release/bundle/dmg/") && readme.includes("src-tauri/target/release/bundle/nsis/") && readme.includes("src-tauri/target/release/bundle/deb/"));
check("README documents release assets", readme.includes("RELEASE-MANIFEST.json") && readme.includes("SHA256SUMS.txt") && readme.includes("lan-smoke-report.md") && readme.includes("release-candidate-summary.md"));
check("README links release checklist", readme.includes("docs/release-checklist.md"));
check("README links first LAN runbook", readme.includes("docs/first-lan-test.md"));
check("README links first LAN evidence report", readme.includes("docs/lan-smoke-report-template.md"));
check("README links transport roadmap", readme.includes("docs/transport-roadmap.md"));
check("Detailed docs cover Rust test behavior", readme.includes("npm run test:rust") && releaseChecklist.includes("single-threaded `cargo test`"));
check("Detailed docs cover rustfmt health check", releaseChecklist.includes("npm run check:rustfmt") && releaseChecklist.includes("librustc_driver"));
check("Detailed docs cover release summary", releaseChecklist.includes("npm run release:summary") && releaseChecklist.includes("per-platform coverage"));
check("Detailed docs cover release manifest verification", releaseChecklist.includes("RELEASE-MANIFEST.json") && releaseChecklist.includes("verify:release-manifest"));
check("Detailed docs cover pre-tag artifact promotion", releaseChecklist.includes("remoteshare-release-assets") && releaseChecklist.includes("release-candidate-summary.md") && releaseChecklist.includes("release-artifacts"));
check("Detailed docs cover final release readiness verifier", releaseChecklist.includes("verify:release-readiness") && releaseChecklist.includes("completed-lan-smoke-report.md"));
check("Detailed docs cover X25519 pairing milestone", architecture.includes("X25519") && networkingMilestone.includes("X25519"));
check("Detailed docs cover typed code confirmation", firstLanTest.includes("six-digit") && firstLanTest.includes("Confirm"));
check("Detailed docs cover private-network inbound guard", firstLanTest.includes("Private network only") && architecture.includes("private-network-only inbound control"));
check("Detailed docs cover first MVP input direction", firstLanTest.includes("macOS is the sender/main computer") && firstLanTest.includes("Windows is the receiver/client"));
check("Detailed docs cover IPv4 and IPv6 endpoint support", networkingMilestone.includes("IPv6 plus IPv4 listener support") && networkingMilestone.includes("local IPv4 and IPv6 control endpoints"));
check("First LAN runbook exists", fs.existsSync("docs/first-lan-test.md"));
check("First LAN runbook documents firewall ports", firstLanTest.includes("TCP `44777`") && firstLanTest.includes("UDP `44778`"));
check("First LAN runbook documents private network guard", firstLanTest.includes("Private network only"));
check("First LAN runbook documents macOS sender to Windows receiver", firstLanTest.includes("macOS is the sender/main computer") && firstLanTest.includes("Windows is the receiver/client"));
check("First LAN runbook documents role setup", firstLanTest.includes("macOS sender role to `Main`") && firstLanTest.includes("Windows receiver role to `Client`") && firstLanTest.includes("receiver role is `Client` or `Both`"));
check("First LAN runbook documents role-aware setup checklist", firstLanTest.includes("setup checklist is role-aware") && firstLanTest.includes("on macOS it expects the sender role, Mac input permissions, the Windows client as peer, and Windows receive setup") && firstLanTest.includes("on Windows it expects the receiver role, Windows injection readiness, the Mac sender as peer, and local receive permission"));
check("First LAN acceptance records role evidence", firstLanTest.includes("| macOS role shown | Main | Main |") && firstLanTest.includes("| Windows role shown | Client | Client |"));
check("First LAN runbook documents Windows Defender Firewall setup", firstLanTest.includes("Windows Security > Firewall") && firstLanTest.includes("New-NetFirewallRule"));
check("First LAN runbook scopes Windows firewall rules to Private", firstLanTest.includes("-Profile Private"));
check("First LAN runbook documents macOS firewall setup", firstLanTest.includes("System Settings > Network > Firewall") && firstLanTest.includes("allow incoming connections for RemoteShare"));
check("First LAN runbook documents manual pair fallback", firstLanTest.includes("Manual pair") && firstLanTest.includes("Record whether discovery was skipped, blocked, unavailable, or failed") && firstLanTest.includes("endpoint was copied from the peer computer"));
check("First LAN runbook explains choosing among local endpoints", firstLanTest.includes("If multiple endpoints are shown") && firstLanTest.includes("routable IPv6 endpoints can be used") && firstLanTest.includes("link-local IPv6"));
check("First LAN runbook documents local-only and public endpoint rejection", firstLanTest.includes("Manual pair rejects `localhost`") && firstLanTest.includes("localhost.localdomain") && firstLanTest.includes("0.0.0.0") && firstLanTest.includes("public literal IPs while `Private network only` is enabled"));
check("First LAN runbook documents Windows TCP reachability check", firstLanTest.includes("Test-NetConnection <other-computer-ip> -Port 44777"));
check("First LAN runbook requires manual code entry", firstLanTest.includes("Type the six-digit code shown on the other computer"));
check("First LAN runbook documents full fingerprint copy", firstLanTest.includes("Trusted Device Audit") && firstLanTest.includes("full local and peer fingerprints"));
check("First LAN runbook documents reconnect check", firstLanTest.includes("Auto reconnect") && firstLanTest.includes("Use `Check`"));
check("First LAN runbook documents startup health check", firstLanTest.includes("startup health") && firstLanTest.includes("TCP and UDP ready"));
check("First LAN runbook documents stale endpoint recovery", firstLanTest.includes("Stale or missing saved endpoint") && firstLanTest.includes("Set IP") && firstLanTest.includes("Verify IP") && firstLanTest.includes("without pairing again") && firstLanTest.includes("Failed trusted checks, test input, and capture forwarding should point to this recovery path") && firstLanTest.includes("even before a failure is recorded"));
check("First LAN runbook documents stale manual re-pair recovery", firstLanTest.includes("Stale trusted record without an input secret or endpoint") && firstLanTest.includes("use `Pair manually`") && firstLanTest.includes("paste the current endpoint copied from the other computer") && firstLanTest.includes("confirm the new six-digit code on both machines") && firstLanTest.includes("`Set IP` / `Verify IP` is only for trusted devices that already show input control ready"));
check("First LAN runbook documents receive shortcut", firstLanTest.includes("use `Enable` in the input-control summary") && firstLanTest.includes("Confirm the receiving trusted row shows `Receive` enabled"));
check("First LAN runbook has MVP acceptance evidence table", firstLanTest.includes("## MVP Acceptance Evidence") && firstLanTest.includes("Auto-discovery run") && firstLanTest.includes("Manual fallback run"));
check("First LAN runbook links smoke report template", firstLanTest.includes("lan-smoke-report-template.md"));
check("First LAN runbook documents smoke report verifier", firstLanTest.includes("npm run verify:lan-smoke-report"));
check("First LAN acceptance requires pairing, reconnect, input smoke, and capture coverage", firstLanTest.includes("macOS-to-Windows pairing") && firstLanTest.includes("trusted reconnect after restart") && firstLanTest.includes("input smoke") && firstLanTest.includes("captured mouse/key/scroll forwarding"));
check("First LAN acceptance records endpoint source and failure reason evidence", firstLanTest.includes("Endpoint source shown") && firstLanTest.includes("Record that exact source text") && firstLanTest.includes("Failure reason before retry") && firstLanTest.includes("visible UI diagnostic/recovery hint"));
check("LAN smoke report template exists", fs.existsSync("docs/lan-smoke-report-template.md"));
check("LAN smoke report template documents exact SHA-256 evidence", lanSmokeReport.includes("64-character SHA-256 values") && lanSmokeReport.includes("RELEASE-MANIFEST.json"));
check("LAN smoke report template documents manual endpoint evidence", lanSmokeReport.includes("peer computer's copied control endpoint") && lanSmokeReport.includes("discovery was disabled, skipped, unavailable, or failed") && lanSmokeReport.includes("endpoint was copied from the peer computer's `This computer` row") && lanSmokeReport.includes("private IPv4 or unique-local IPv6") && lanSmokeReport.includes("not a public IP literal or link-local IPv6 address") && lanSmokeReport.includes("192.168.1.20:44777") && lanSmokeReport.includes("[fd00::20]:44777"));
check("LAN smoke report template documents auto-discovery subnet evidence", lanSmokeReport.includes("same-subnet IPv4 CIDR values") && lanSmokeReport.includes("192.168.1.10/24") && lanSmokeReport.includes("192.168.1.20/24"));
check("LAN smoke report records auto-discovery and manual fallback", lanSmokeReport.includes("## Auto-Discovery Run") && lanSmokeReport.includes("## Manual Fallback Run"));
check("LAN smoke report does not allow blocking issues to satisfy readiness", lanSmokeReport.includes("does not satisfy release readiness") && !lanSmokeReport.includes("pass result or a tracked blocking issue"));
check("LAN smoke report records ISO calendar test date", lanSmokeReport.includes("Test date row must use an ISO `YYYY-MM-DD` calendar date") && lanSmokeVerifier.includes("requireIsoDate") && lanSmokeVerifier.includes("must be a valid calendar date") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("malformed test date should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("invalid test date should fail"));
check("LAN smoke report records pairing, reconnect, startup health, and specific input smoke", lanSmokeReport.includes("Same six-digit code shown on both machines") && lanSmokeReport.includes("Startup health shows TCP ready, UDP ready, and start-at-login not failed") && lanSmokeReport.includes("`Check` succeeded after restart/wake") && lanSmokeReport.includes("Sender `Test` delivered accepted `key press r` input event") && lanSmokeReport.includes("Input Transport source device and relative time shown"));
check("LAN smoke report template documents concrete input smoke evidence", lanSmokeReport.includes("Input smoke rows must say the receiver accepted a `key press r` event") && lanSmokeReport.includes("Input Transport row showed the source device plus relative time"));
check("LAN smoke report template requires full capture forwarding evidence", lanSmokeReport.includes("Capture rows must show capture started and stopped cleanly") && lanSmokeReport.includes("active capture target plus elapsed start time was visible") && lanSmokeReport.includes("Captured mouse move, mouse click, scroll, and key events accepted on receiver"));
check("LAN smoke report template documents concrete reconnect evidence", lanSmokeReport.includes("Auto reconnect stayed enabled after restart/wake") && lanSmokeReport.includes("`Check` succeeded after restart/wake") && lanSmokeReport.includes("startup health showed TCP ready, UDP ready, and start-at-login not failed") && lanSmokeReport.includes("endpoint source was shown as discovery or reconnect") && lanSmokeReport.includes("saved endpoint or manual IP"));
check("LAN smoke report template points fingerprint evidence to audit view", lanSmokeReport.includes("Trusted Device Audit view") && lanSmokeReport.includes("local and peer full fingerprints"));
check("LAN smoke report template documents failure reason evidence", lanSmokeReport.includes("Failure reason rows must say `none` or `no failure`") && lanSmokeReport.includes("visible UI diagnostic or recovery hint shown before retry"));
check("LAN smoke report records input direction", lanSmokeReport.includes("Input direction") && lanSmokeVerifier.includes("\"Input direction\""));
check("LAN smoke report verifier enforces first MVP input direction", lanSmokeVerifier.includes("requireInputDirection") && lanSmokeVerifier.includes("macOS sender/main -> Windows receiver/client") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("wrong input direction should fail"));
check("LAN smoke report verifies first MVP roles", lanSmokeReport.includes("macOS role shown") && lanSmokeReport.includes("Windows role shown") && lanSmokeReport.includes("macOS as `Main` and Windows as `Client`") && lanSmokeVerifier.includes("requireMvpRoles") && lanSmokeVerifier.includes("macOS role shown") && lanSmokeVerifier.includes("Windows role shown") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("wrong macOS role should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("wrong Windows role should fail"));
check("LAN smoke report records firewall and permission context", lanSmokeReport.includes("macOS firewall status") && lanSmokeReport.includes("Windows firewall status") && lanSmokeReport.includes("macOS Input Monitoring permission"));
check("LAN smoke report template documents firewall and permission success evidence", lanSmokeReport.includes("Firewall rows must show allowed/successful status") && lanSmokeReport.includes("Accessibility plus Input Monitoring must be enabled"));
check("LAN smoke report verifier enforces firewall and permission success evidence", lanSmokeVerifier.includes("requireSuccess(context, \"macOS firewall status\"") && lanSmokeVerifier.includes("requireSuccess(context, \"Windows firewall status\"") && lanSmokeVerifier.includes("requireSuccess(context, \"macOS Accessibility permission\"") && lanSmokeVerifier.includes("requireSuccess(context, \"macOS Input Monitoring permission\"") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("blocked firewall should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("denied input monitoring should fail"));
check("LAN smoke report verifier enforces concrete reconnect evidence", lanSmokeVerifier.includes("requireReconnectEvidence") && lanSmokeVerifier.includes("Auto reconnect evidence must show it stayed enabled after restart or wake") && lanSmokeVerifier.includes("startup health evidence must mention TCP ready, UDP ready, and start-at-login not failed") && lanSmokeVerifier.includes("startupHealthWithoutExpectedNegative") && lanSmokeVerifier.includes("valueWithoutExpectedNegative") && lanSmokeVerifier.includes("reconnect check evidence must show Check succeeded after restart or wake") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague reconnect should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague startup health should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("explicit startup not failed evidence should pass") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("failed startup health should fail"));
check("LAN smoke report verifier rejects none as generic success", !lanSmokeVerifier.includes("ready|none|n\\/a") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("none should not satisfy success evidence"));
check("LAN smoke report verifier rejects contradictory success evidence", lanSmokeVerifier.includes("fail|failed|failure|blocked|denied|error") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("positive-prefix failure evidence should fail"));
check("LAN smoke report verifier enforces concrete endpoint source evidence", lanSmokeVerifier.includes("requireEndpointSourceEvidence") && lanSmokeVerifier.includes("endpoint source evidence must mention the concrete source shown in the UI") && lanSmokeVerifier.includes("not\\s+(shown|discovery|reconnect|saved|manual|verified|set)") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague auto endpoint source should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague manual endpoint source should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("contradictory auto endpoint source should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("contradictory manual endpoint source should fail"));
check("LAN smoke report verifier enforces manual fallback evidence", lanSmokeVerifier.includes("requireManualFallbackEvidence") && lanSmokeVerifier.includes("discoveryFallbackFailurePattern") && lanSmokeVerifier.includes("discoverySuccessPattern") && lanSmokeVerifier.includes("discovery evidence must explain that discovery was disabled, skipped, unavailable, or failed") && lanSmokeVerifier.includes("endpoint copy evidence must mention copying the peer computer") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague manual discovery fallback should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("successful manual discovery fallback should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague manual endpoint copy should fail"));
check("LAN smoke report verifier enforces concrete input smoke evidence", lanSmokeVerifier.includes("requireInputSmokeEvidence") && lanSmokeVerifier.includes("input smoke evidence must mention an accepted key press r event") && lanSmokeVerifier.includes("input transport evidence must mention the source device and relative time") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague input smoke should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague input transport context should fail"));
check("LAN smoke report verifier enforces concrete fingerprint evidence", lanSmokeVerifier.includes("requireFingerprintEvidence") && lanSmokeVerifier.includes("full local and peer fingerprints copied or compared from the audit view") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague fingerprint evidence should fail"));
check("LAN smoke report verifier enforces full capture forwarding evidence", lanSmokeVerifier.includes("requireCaptureEvidence") && lanSmokeVerifier.includes("capture evidence must show capture started and stopped cleanly") && lanSmokeVerifier.includes("capture timing evidence must mention the active capture target and elapsed start time") && lanSmokeVerifier.includes("capture evidence must mention accepted mouse move, mouse click, scroll, and key events") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague capture timing should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague capture event coverage should fail"));
check("LAN smoke report verifier enforces concrete failure reason evidence", lanSmokeVerifier.includes("requireFailureReasonEvidence") && lanSmokeVerifier.includes("failure reason evidence must say none/no failure") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("vague failure reason evidence should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("qualified no-failure evidence should pass") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("ambiguous no-failure evidence should fail"));
check("LAN smoke report records installer checksums", lanSmokeReport.includes("macOS installer SHA256") && lanSmokeReport.includes("Windows installer SHA256") && lanSmokeReport.includes("Linux installer SHA256"));
check("LAN smoke report verifier script exists", fs.existsSync(lanSmokeVerifierPath));
check("LAN smoke report verifier requires pass results", lanSmokeVerifier.includes("must be marked Pass") && lanSmokeVerifier.includes("Auto-Discovery Run") && lanSmokeVerifier.includes("Manual Fallback Run"));
check("LAN smoke report verifier requires Linux artifact evidence, package-version filenames, platform extensions, and SHA-256 hashes", lanSmokeVerifier.includes("\"Linux installer file\"") && lanSmokeVerifier.includes("\"Linux installer SHA256\"") && lanSmokeVerifier.includes("requirePackageVersion") && lanSmokeVerifier.includes("requireInstallerFile") && lanSmokeVerifier.includes("endsWith(extension)") && lanSmokeReport.includes("platform package extensions `.dmg`, `.exe`, and `.deb`") && lanSmokeVerifier.includes("requireSha256") && lanSmokeVerifier.includes("64-character SHA-256 hex value") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("missing Linux installer field should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("wrong installer version should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("wrong installer extension should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("invalid installer sha should fail"));
check("LAN smoke report verifier requires concrete manual endpoint evidence", lanSmokeVerifier.includes("requireManualEndpoint") && lanSmokeVerifier.includes("parseEndpoint") && lanSmokeVerifier.includes("TCP port 44777") && lanSmokeVerifier.includes("not localhost or an unspecified bind address") && lanSmokeVerifier.includes("private IPv4 or unique-local IPv6 endpoint literal") && lanSmokeVerifier.includes("public IP literal while Private network only is enabled") && lanSmokeVerifier.includes("link-local IPv6 literal") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("wrong manual endpoint port should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("localhost manual endpoint should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("hostname manual endpoint should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("public manual endpoint should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("link-local IPv6 manual endpoint should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("bracketed IPv6 manual endpoint should pass"));
check("LAN smoke report verifier requires concrete auto-discovery subnet evidence", lanSmokeVerifier.includes("requireAutoDiscoverySubnetEvidence") && lanSmokeVerifier.includes("parseIpv4Cidr") && lanSmokeVerifier.includes("networkNumber") && lanSmokeVerifier.includes("same IPv4 subnet") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("malformed auto-discovery CIDR should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("different auto-discovery subnet should fail"));
check("LAN smoke report verifier fixture test exists", fs.existsSync("scripts/test-lan-smoke-report-verifier.mjs"));
check("LAN smoke report verifier tests missing fields, duplicate fields, failed reconnect, and blocking issue bypass", fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("missing required field should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("duplicate context field should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("duplicate auto run field should fail") && lanSmokeVerifier.includes("Duplicate LAN smoke report field") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("failed reconnect should fail") && fs.readFileSync("scripts/test-lan-smoke-report-verifier.mjs", "utf8").includes("tracked blocking issue should not satisfy release readiness"));
check("LAN smoke report preparation helper exists", fs.existsSync(lanSmokePreparerPath));
check("LAN smoke report preparation helper fills release rows and avoids overwrites", lanSmokePreparer.includes("lan-smoke-report-template.md") && lanSmokePreparer.includes("already exists") && lanSmokePreparer.includes("macOS installer SHA256") && lanSmokePreparer.includes("Linux installer SHA256"));
check("LAN smoke report preparation helper rejects mismatched release manifest versions and stale artifacts", lanSmokePreparer.includes("manifest.version !== packageJson.version") && lanSmokePreparer.includes("validateReleaseManifestArtifact") && releaseArtifactsLib.includes("artifact filename must include package version") && lanSmokePreparer.includes("artifact file is missing") && lanSmokePreparer.includes("artifact hash mismatch") && lanSmokePreparer.includes("validateManifestArtifactTypes") && releaseArtifactsLib.includes("duplicate artifact type") && releaseArtifactsLib.includes("unexpected artifact type") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("wrong manifest version should fail") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("wrong artifact version should fail") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("duplicate manifest type should fail") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("unexpected manifest type should fail") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("missing artifact file should fail") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("artifact hash mismatch should fail"));
check("LAN smoke report preparation helper fixture test exists", fs.existsSync("scripts/test-prepare-lan-smoke-report.mjs"));
check("LAN smoke report preparation helper tests valid report and overwrite guard", fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("valid report should be prepared") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("existing report should fail") && fs.readFileSync("scripts/test-prepare-lan-smoke-report.mjs", "utf8").includes("missing deb should fail"));
check("Smoke report release rows helper exists", fs.existsSync(smokeReportRowsPath));
check("Smoke report release rows helper prints installer filenames and checksums", smokeReportRows.includes("macOS installer SHA256") && smokeReportRows.includes("Windows installer SHA256") && smokeReportRows.includes("Linux installer SHA256") && smokeReportRows.includes("RELEASE-MANIFEST.json"));
check("Smoke report release rows helper verifies release artifacts before printing rows", smokeReportRows.includes("manifest.version !== packageJson.version") && smokeReportRows.includes("validateReleaseManifestArtifact") && smokeReportRows.includes("artifact file is missing") && smokeReportRows.includes("artifact hash mismatch") && smokeReportRows.includes("validateManifestArtifactTypes") && releaseArtifactsLib.includes("duplicate artifact type") && releaseArtifactsLib.includes("unexpected artifact type") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("wrong manifest version should fail") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("duplicate manifest type should fail") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("unexpected manifest type should fail") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("missing artifact file should fail") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("artifact hash mismatch should fail"));
check("Smoke report release rows helper fixture test exists", fs.existsSync("scripts/test-smoke-report-release-rows.mjs"));
check("Smoke report release rows helper tests missing manifest, missing exe, and stale artifacts", fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("missing manifest should fail") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("missing exe should fail") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("missing deb should fail") && fs.readFileSync("scripts/test-smoke-report-release-rows.mjs", "utf8").includes("artifact hash mismatch should fail"));
check("Release candidate summary helper exists", fs.existsSync(releaseCandidateSummaryPath));
check("Release candidate summary helper prints smoke commands, input evidence, and verifies artifacts", releaseCandidateSummary.includes("RemoteShare Release Candidate") && releaseCandidateSummary.includes("npm run verify:release-readiness") && releaseCandidateSummary.includes("Trusted Device Audit view") && releaseCandidateSummary.includes("startup health TCP, UDP, and Start detail strings") && releaseCandidateSummary.includes("accepted \\`key press r\\` test input") && releaseCandidateSummary.includes("Input Transport source device and relative time") && releaseCandidateSummary.includes("active capture target and elapsed start time") && releaseCandidateSummary.includes("accepted mouse move, mouse click, scroll, and key events") && releaseCandidateSummary.includes("Linux DEB is included for package coverage evidence") && releaseCandidateSummary.includes("requiredArtifactTypes") && releaseCandidateSummary.includes("crypto.createHash(\"sha256\")") && releaseCandidateSummary.includes("artifact file is missing") && releaseCandidateSummary.includes("artifact hash mismatch"));
check("Release candidate summary helper validates manifest artifact shape", releaseCandidateSummary.includes("publishArtifactStatus") && releaseCandidateSummary.includes("duplicate type(s)") && releaseCandidateSummary.includes("validateReleaseManifestArtifact") && releaseArtifactsLib.includes("invalid type") && releaseArtifactsLib.includes("basename-only") && releaseArtifactsLib.includes("invalid sha256") && releaseArtifactsLib.includes("invalid sizeBytes") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("duplicate manifest type should fail") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("invalid manifest type should fail"));
check("Release candidate summary helper fixture test exists", fs.existsSync("scripts/test-release-candidate-summary.mjs"));
check("Release candidate summary helper tests valid summary, input evidence, and missing assets", fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("valid summary should pass") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("Trusted Device Audit") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("startup health TCP, UDP, and Start detail strings") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("accepted `key press r` test input") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("Input Transport source device and relative time") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("active capture target and elapsed start time") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("accepted mouse move, mouse click, scroll, and key events") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("missing manifest should fail") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("missing deb should fail") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("duplicate manifest type should fail") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("invalid manifest type should fail") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("wrong version should fail") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("missing file should fail") && fs.readFileSync("scripts/test-release-candidate-summary.mjs", "utf8").includes("hash mismatch should fail"));
check("Release readiness verifier script exists", fs.existsSync(releaseReadinessVerifierPath));
check("Release readiness verifier combines assets, prefilled smoke report, candidate summary, and LAN evidence", releaseReadinessVerifier.includes("verify-release-manifest.mjs") && releaseReadinessVerifier.includes("verify-lan-smoke-report.mjs") && releaseReadinessVerifier.includes("verifyPrefilledLanSmokeReport") && releaseReadinessVerifier.includes("verifyReleaseCandidateSummary"));
check("Release readiness verifier matches smoke installers to manifest", releaseReadinessVerifier.includes("macOS installer file") && releaseReadinessVerifier.includes("Windows installer file") && releaseReadinessVerifier.includes("Linux installer file") && releaseReadinessVerifier.includes("must match release"));
check("Release readiness verifier matches smoke checksums to manifest", releaseReadinessVerifier.includes("macOS installer SHA256") && releaseReadinessVerifier.includes("Windows installer SHA256") && releaseReadinessVerifier.includes("Linux installer SHA256") && releaseReadinessVerifier.includes("must match release"));
check("Release readiness verifier matches smoke version to package version", releaseReadinessVerifier.includes("RemoteShare version/tag") && releaseReadinessVerifier.includes("package version"));
check("Release readiness verifier prevents stale smoke evidence", releaseReadinessVerifier.includes("assertSmokeDateMatchesManifest") && releaseReadinessVerifier.includes("validateReleaseGeneratedAt") && releaseArtifactsLib.includes("generatedAt must be a valid ISO-8601 UTC timestamp") && releaseReadinessVerifier.includes("Test date must be on or after release manifest date") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("stale LAN smoke test date should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("malformed LAN smoke test date should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("missing release manifest generatedAt should fail"));
check("Release readiness verifier fixture test exists", fs.existsSync("scripts/test-release-readiness-verifier.mjs"));
check("Release readiness verifier tests missing manifest, tampered artifacts, stale checksums, prefilled smoke report, candidate summary, failed smoke report, mismatched installers, mismatched version, mismatched hashes, and duplicate context rows", fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("missing release manifest should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("tampered release artifact should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("stale release checksum should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("missing prefilled LAN smoke report should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched prefilled LAN smoke report should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("missing release candidate summary should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched release candidate summary should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("failed LAN smoke report should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched LAN smoke installer should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched LAN smoke Windows installer should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched LAN smoke Linux installer should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched LAN smoke version should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched LAN smoke checksum should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched LAN smoke Windows checksum should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("mismatched LAN smoke Linux checksum should fail") && fs.readFileSync("scripts/test-release-readiness-verifier.mjs", "utf8").includes("duplicate LAN smoke context rows should fail") && releaseReadinessVerifier.includes("Duplicate smoke report field"));
check("GitHub release asset verifier script exists", fs.existsSync(githubReleaseAssetVerifierPath));
check("GitHub release asset verifier matches draft tag, manifest files, asset sizes, digests, and manifest artifact bytes", githubReleaseAssetVerifier.includes("GitHub release must stay draft") && githubReleaseAssetVerifier.includes("release.tagName") && githubReleaseAssetVerifier.includes("RELEASE-MANIFEST.json") && githubReleaseAssetVerifier.includes("SHA256SUMS.txt") && githubReleaseAssetVerifier.includes("lan-smoke-report.md") && githubReleaseAssetVerifier.includes("release-candidate-summary.md") && githubReleaseAssetVerifier.includes("Release manifest size mismatch") && githubReleaseAssetVerifier.includes("Release manifest hash mismatch") && githubReleaseAssetVerifier.includes("asset.size !== localSize") && githubReleaseAssetVerifier.includes("asset.digest && asset.digest !== localDigest"));
check("GitHub release asset verifier validates manifest artifact shape", githubReleaseAssetVerifier.includes("publishArtifactStatus") && githubReleaseAssetVerifier.includes("duplicate type(s)") && githubReleaseAssetVerifier.includes("validateReleaseManifestArtifact") && releaseArtifactsLib.includes("invalid type") && releaseArtifactsLib.includes("basename-only") && releaseArtifactsLib.includes("invalid sha256") && releaseArtifactsLib.includes("invalid sizeBytes") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("duplicate manifest type should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("invalid manifest hash should fail"));
check("GitHub release asset verifier fixture test exists", fs.existsSync("scripts/test-github-release-assets-verifier.mjs"));
check("GitHub release asset verifier tests missing, unexpected, size, digest, tag, draft, and malformed manifest failures", fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("missing exe should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("unexpected asset should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("size mismatch should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("digest mismatch should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("wrong tag should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("published release should fail before LAN smoke") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("duplicate manifest type should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("invalid manifest hash should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("stale manifest size should fail") && fs.readFileSync("scripts/test-github-release-assets-verifier.mjs", "utf8").includes("stale manifest hash should fail"));
check("Release asset download helper exists", fs.existsSync(releaseAssetDownloaderPath));
check("Release asset download helper downloads a draft release into an empty directory and verifies assets", releaseAssetDownloader.includes("Release asset output directory must be empty") && releaseAssetDownloader.includes("gh\", [") && releaseAssetDownloader.includes("\"release\"") && releaseAssetDownloader.includes("\"view\"") && releaseAssetDownloader.includes("\"download\"") && releaseAssetDownloader.includes("github-release.json") && releaseAssetDownloader.includes("verify-github-release-assets.mjs") && releaseAssetDownloader.includes("verify-release-manifest.mjs"));
check("Release asset download helper fixture test exists", fs.existsSync(releaseAssetDownloaderTestPath));
check("Release asset download helper fixture test covers valid, stale-output, and wrong-tag cases", releaseAssetDownloaderTest.includes("valid download should pass") && releaseAssetDownloaderTest.includes("non-empty output should fail") && releaseAssetDownloaderTest.includes("wrong tag should fail"));
check("Release checklist exists", fs.existsSync("docs/release-checklist.md"));
check("Release checklist documents native installer platforms", releaseChecklist.includes("macOS `.dmg`") && releaseChecklist.includes("Windows `.exe`") && releaseChecklist.includes("Linux `.deb`"));
check("Release checklist documents Rust unit test gate", releaseChecklist.includes("npm run test:rust") && releaseChecklist.includes("Rust unit tests") && releaseChecklist.includes("single-threaded `cargo test`"));
check("Release checklist documents rustfmt health check", releaseChecklist.includes("npm run check:rustfmt") && releaseChecklist.includes("rustup component add rustfmt") && releaseChecklist.includes("local toolchain diagnostic") && releaseChecklist.includes("librustc_driver"));
check("Release checklist documents disk preflight", releaseChecklist.includes("disk preflight") && releaseChecklist.includes("REMOTESHARE_MIN_FREE_MIB") && releaseChecklist.includes("1024 MiB"));
check("Release checklist documents debug cache cleanup", releaseChecklist.includes("npm run clean:debug-cache") && releaseChecklist.includes("release/bundle"));
check("Release checklist documents bundle temp cleanup", releaseChecklist.includes("npm run clean:bundle-temp") && releaseChecklist.includes("rw.*.dmg") && releaseChecklist.includes("recursive disk usage") && releaseChecklist.includes("hdiutil"));
check("Release checklist documents workflow debug cache cleanup", releaseChecklist.includes("after the Rust check") && releaseChecklist.includes("before the native bundle build"));
check("Release checklist documents workflow bundle temp cleanup", releaseChecklist.includes("stale generated DMG temp files"));
check("Release checklist documents checksum verification", releaseChecklist.includes("npm run checksums:installers") && releaseChecklist.includes("npm run verify:installers"));
check("Release checklist documents checksum generation tests", releaseChecklist.includes("tests checksum generation"));
check("Release checklist documents empty installer rejection", releaseChecklist.includes("reject empty installer artifacts"));
check("Release checklist documents native installer version filename checks", releaseChecklist.includes("installer filenames to include the current package version"));
check("Release checklist documents tag release publishing", releaseChecklist.includes("`v*` tag") && releaseChecklist.includes("GitHub Release") && releaseChecklist.includes("RELEASE-MANIFEST.json") && releaseChecklist.includes("non-empty `.exe`"));
check("Release checklist documents failed tag hygiene", releaseChecklist.includes("If a tagged release workflow fails") && releaseChecklist.includes("do not move, delete, or reuse that tag") && releaseChecklist.includes("cut the next patch tag"));
check("Release checklist documents published LAN smoke report", releaseChecklist.includes("prefilled `lan-smoke-report.md`") && releaseChecklist.includes("release-assets/lan-smoke-report.md"));
check("Release checklist documents release candidate summary", releaseChecklist.includes("release-candidate-summary.md") && releaseChecklist.includes("installer filenames, hashes, and the smoke/readiness commands") && releaseChecklist.includes("still matches the release assets and manifest"));
check("Release checklist documents release candidate job summary", releaseChecklist.includes("publishes that summary into the GitHub Actions job summary") && releaseChecklist.includes("Read the GitHub Actions job summary first"));
check("Release checklist documents publish log smoke rows", releaseChecklist.includes("npm run release:smoke-rows -- release-assets") && releaseChecklist.includes("publish logs show the rows testers should copy"));
check("Release checklist documents draft release asset download helper", releaseChecklist.includes("npm run download:release-assets") && releaseChecklist.includes("empty directory") && releaseChecklist.includes("GitHub asset list, sizes, digests, manifest, and checksums"));
check("Release checklist documents release publish permission", releaseChecklist.includes("contents: write"));
check("Release checklist documents publish artifact completeness", releaseChecklist.includes("npm run verify:publish-artifacts") && releaseChecklist.includes("present exactly once"));
check("Release checklist documents manual assembled release asset", releaseChecklist.includes("The `Assemble Release Assets` job verifies all three native runner outputs") && releaseChecklist.includes("uploads one combined artifact named `remoteshare-release-assets`") && releaseChecklist.includes("writes `release-candidate-summary.md`"));
check("Release checklist documents pre-tag native artifact promotion", releaseChecklist.includes("For a pre-tag build") && releaseChecklist.includes("run the workflow manually") && releaseChecklist.includes("download them into one local directory named `release-artifacts`") && releaseChecklist.includes("npm run verify:publish-artifacts -- release-artifacts") && releaseChecklist.includes("npm run prepare:release-assets -- release-artifacts release-assets") && releaseChecklist.includes("npm run verify:release-manifest -- release-assets") && releaseChecklist.includes("npm run prepare:lan-smoke-report -- release-assets release-assets/lan-smoke-report.md") && releaseChecklist.includes("npm run release:candidate-summary -- release-assets") && releaseChecklist.includes("proving that the Windows `.exe` and Linux `.deb` produced by native runners match the macOS `.dmg`"));
check("Release checklist documents release asset preparation", releaseChecklist.includes("npm run prepare:release-assets") && releaseChecklist.includes("generates combined checksums"));
check("Release checklist documents release manifest verification", releaseChecklist.includes("npm run verify:release-manifest") && releaseChecklist.includes("matches the release assets and checksum file"));
check("Release checklist documents package-version artifact consistency", releaseChecklist.includes("prepared release asset filenames plus `RELEASE-MANIFEST.json` must match the current package version"));
check("Release checklist documents release artifact helper tests", releaseChecklist.includes("release artifact helper"));
check("Release checklist documents scripts-only release gate", releaseChecklist.includes("npm run verify:release-scripts") && releaseChecklist.includes("without running `cargo check`") && releaseChecklist.includes("release manifest verification"));
check("Release checklist documents debug cache cleanup tests", releaseChecklist.includes("debug cache cleanup scripts"));
check("Release checklist documents bundle temp cleanup tests", releaseChecklist.includes("bundle temp cleanup scripts"));
check("Release checklist documents publish job npm setup", releaseChecklist.includes("checks out the repo") && releaseChecklist.includes("sets up Node") && releaseChecklist.includes("installs dependencies"));
check("Release checklist documents platform coverage summary", releaseChecklist.includes("per-platform coverage") && releaseChecklist.includes("flags empty installer artifacts") && releaseChecklist.includes("flags package-version filename mismatches"));
check("Release checklist links first LAN test", releaseChecklist.includes("first-lan-test.md") && releaseChecklist.includes("MVP acceptance evidence table") && releaseChecklist.includes("lan-smoke-report-template.md") && releaseChecklist.includes("npm run prepare:lan-smoke-report") && releaseChecklist.includes("npm run release:smoke-rows") && releaseChecklist.includes("npm run verify:lan-smoke-report") && releaseChecklist.includes("npm run verify:release-readiness") && releaseChecklist.includes("bundled prefilled `lan-smoke-report.md` still matches the release assets, manifest, and current template") && releaseChecklist.includes("same macOS `.dmg`, Windows `.exe`, and Linux `.deb` basenames and 64-character SHA-256 hashes") && releaseChecklist.includes("smoke report version matches the package version"));
check("Transport roadmap exists", fs.existsSync("docs/transport-roadmap.md"));
check("Transport roadmap keeps LAN first", transportRoadmap.includes("Phase 1: Direct LAN") && transportRoadmap.includes("UDP broadcast discovery on `44778`"));
check("Transport roadmap defers internet relay", transportRoadmap.includes("Phase 2: Internet Relay") && transportRoadmap.includes("Internet mode should start only after LAN input sharing is stable"));
check("Transport roadmap defers Bluetooth", transportRoadmap.includes("Phase 3: Bluetooth") && transportRoadmap.includes("Bluetooth is deferred"));
check("Transport roadmap requires encrypted relay input", transportRoadmap.includes("encrypted keyboard or mouse input") && transportRoadmap.includes("encrypted end to end"));
check("UI keeps Scan LAN control for runbook", appUi.includes("Scan LAN"));
check("Scan LAN sends an immediate discovery beacon", networkRuntime.includes("pub async fn scan_lan") && networkRuntime.includes("send_discovery_payload") && networkRuntime.includes("announcement.scan_request = true") && networkRuntime.includes("discovery_reply_target") && runtimeStore.includes("pub scan_request: bool") && tauriAppRuntime.includes("network::scan_lan") && networkingMilestone.includes("scan request flag") && networkingMilestone.includes("Peers answer accepted scan requests directly"));
check("Scan LAN replies only to accepted peers", runtimeStore.includes("pub fn record_peer(&self, announcement: PeerAnnouncement, endpoint: String) -> bool") && runtimeStore.includes("return false;") && /true\s+}/.test(runtimeStore) && networkRuntime.includes("let accepted = store.record_peer") && networkRuntime.includes("accepted && reply_requested") && networkingMilestone.includes("same self-device, normalized endpoint, advertised control-port match, private-network guard, trusted fingerprint, and advertised public-key validation"));
check("Discovery rejects endpoint control-port mismatches", runtimeStore.includes("normalized_endpoint_port(&endpoint) != Some(announcement.control_port)") && runtimeStore.includes("mismatched-port") && runtimeStore.includes("non-default-port") && networkingMilestone.includes("advertised control-port match"));
check("Discovery records only normalized endpoints", runtimeStore.includes("let Some(endpoint) = normalized_endpoint(&endpoint)") && runtimeStore.includes("invalid-endpoint") && networkingMilestone.includes("normalized endpoint"));
check("UI keeps Manual pair control for runbook", appUi.includes("Manual pair"));
check("UI explains manual endpoint defaults and rejected endpoints", appUi.includes("manual-endpoint-hint") && appUi.includes("Missing ports use 44777") && appUi.includes("Localhost, loopback, unspecified, and link-local IPv6 endpoints are rejected") && appUi.includes("Public IP literals are blocked while Private network only is on"));
check("UI keeps pairing Confirm control for runbook", appUi.includes("Confirm"));
check("UI keeps Check control for runbook", appUi.includes("Check"));
check("UI keeps Test control for runbook", appUi.includes("Test"));
check("UI keeps Capture and Stop controls for runbook", appUi.includes("Capture") && appUi.includes("Stop"));
check("UI shows active capture target and start timing", appUi.includes("captureTarget?.name") && appUi.includes("status.capture.startedAtMs") && appUi.includes("started ${elapsedLabel"));
check("UI keeps incoming control labels for runbook", appUi.includes("Allow incoming control") && appUi.includes("Receive"));
check("UI exposes receive shortcut for trusted devices", appUi.includes("enableReceiveForTrustedDevices") && appUi.includes("receiveShortcutAvailable") && appUi.includes("enable_receive_for_trusted_devices"));
check("UI disables stale trusted receive toggles", appUi.includes("row-toggle-disabled") && appUi.includes("Re-pair this device before enabling receive") && appUi.includes("disabled={!device.inputControlReady || !receiveRoleReady}"));
check("UI routes stale trusted devices without endpoints to manual re-pair", appUi.includes("prepareManualRepair") && appUi.includes("Pair manually") && appUi.includes("setManualEndpoint(device.lastConnectionFailure?.endpoint ?? \"\")") && appUi.includes("Manual pair field set to the last failed endpoint") && appUi.includes("Paste the current endpoint for") && appUi.includes("Manual pair, then connect and confirm the new code on both computers") && appUi.includes("device.trusted && !device.endpoint && !device.inputControlReady"));
check("UI surfaces stale no-endpoint trust in connection path", appUi.includes("staleTrustedDevicesNeedingRepair") && appUi.includes("Manual re-pair needed") && appUi.includes("needs Pair manually with a copied endpoint"));
check("UI disables global receive toggle outside receive roles", appUi.includes("disabled={!receiveRoleReady}") && appUi.includes("Set this computer role to Client or Both before enabling receive.") && appUi.includes("receiveRoleReady && status.allowIncomingControl"));
check("UI shows Mac-to-Windows setup checklist", appUi.includes("setupSteps") && appUi.includes("Choose roles") && appUi.includes("Mac main -> Windows client") && appUi.includes("Verify input"));
check("UI setup checklist is role-aware for macOS sender and Windows receiver", appUi.includes("mvpRoleStep") && appUi.includes("isMacPlatform") && appUi.includes("isWindowsPlatform") && appUi.includes("Set this Windows computer to Client") && appUi.includes("Set this Mac to Main"));
check("UI setup checklist uses platform-aware input readiness", appUi.includes("mvpInputPermissionStep") && appUi.includes("Windows receive ready") && appUi.includes("permissions.injectionEngine === \"ready\"") && appUi.includes("Mac input permissions") && appUi.includes("permissions.captureEngine === \"ready\""));
check("UI setup checklist uses platform-aware peer discovery and receive setup", appUi.includes("mvpDiscoveryStep") && appUi.includes("Find Mac sender") && appUi.includes("Find Windows client") && appUi.includes("mvpReceiveStep") && appUi.includes("Windows receive setup") && appUi.includes("trusted Mac row"));
check("UI does not keep decorative sidebar nav", !appUi.includes("className=\"nav\"") && !appUi.includes("className=\"nav-item"));
check("UI exposes local computer role selector", appUi.includes("This computer role") && appUi.includes("value=\"main\"") && appUi.includes("value=\"client\"") && appUi.includes("value=\"both\"") && appUi.includes("roleLabel(status.mode)"));
check("UI shows peer roles in device, audit, and pairing rows", appUi.includes("{device.platform} · {roleLabel(device.role)} · {connectionLabel(device)}") && appUi.includes("<dt>Role</dt>") && appUi.includes("{roleLabel(pairing.role)}"));
check("UI exposes private network guard setting", appUi.includes("Private network only") && appUi.includes("privateNetworkOnly"));
check("UI explains local endpoint choice", appUi.includes("same Wi-Fi/LAN subnet") && appUi.includes("IPv6 is available for manual fallback"));
check("UI shows all copyable local endpoints", appUi.includes("localEndpoints.map") && !appUi.includes("localEndpoints.slice"));
check("UI can copy full trusted fingerprint", appUi.includes("copyFingerprint") && appUi.includes("Full fingerprint"));
check("Runtime exposes local public key fingerprint for audit", runtimeStore.includes("this_public_key_fingerprint") && runtimeStore.includes("status_exposes_local_public_key_fingerprint_for_audit") && appUi.includes("thisPublicKeyFingerprint"));
check("Runtime gates global receive settings by local role", runtimeStore.includes("global_receive_requires_receive_role") && runtimeStore.includes("changing_to_main_clears_receive_permissions") && runtimeStore.includes("Set this computer role to Client or Both before enabling receive.") && networkingMilestone.includes("Direct global receive setting updates are rejected unless this computer can receive input"));
check("Runtime clears capture when local role cannot send", runtimeStore.includes("changing_to_client_clears_active_capture") && runtimeStore.includes("state.capture.active = false") && networkingMilestone.includes("Switching the local role away from send capability clears any active capture session"));
check("Runtime gates public manual endpoints by private network setting", runtimeStore.includes("PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE") && runtimeStore.includes("private_network_guard_rejects_public_manual_endpoint_literals") && runtimeStore.includes("public_manual_endpoint_literals_require_private_guard_off") && runtimeStore.includes("private_network_guard_skips_public_trusted_endpoint_candidates") && runtimeStore.includes("private_guard_allows_endpoint") && networkingMilestone.includes("Public literal IP manual endpoints and trusted endpoint updates are also rejected while `Private network only` is enabled"));
check("Runtime gates public discovery by private network setting", runtimeStore.includes("public_discovery_requires_private_guard_off") && runtimeStore.includes("public-discovery") && networkingMilestone.includes("UDP discovery reject non-private remote addresses by default"));
check("UI exposes trusted device audit view", appUi.includes("Trusted Device Audit") && appUi.includes("audit-panel") && appUi.includes("endpointSourceLabel(device)") && appUi.includes("connectionFailureDiagnostic(device)") && appUi.includes("connectionFailureHint(device)") && appUi.includes("audit-failure-hint") && appUi.includes("Input secret"));
check("UI bases failure recovery hints on failed endpoint source", appUi.includes("failure.endpointSource === \"saved\"") && appUi.includes("failure.endpointSource === \"discovery\"") && appUi.includes("failure.endpointSource === \"health\"") && appUi.includes("failure.endpointSource === \"manual\"") && appUi.includes("Saved endpoint may be stale") && appUi.includes("Last reconnect endpoint may be stale") && appUi.includes("Manual IP verification failed") && runtimeStore.includes("struct ConnectionFailure") && runtimeStore.includes("endpoint_source: EndpointSource") && runtimeStore.includes("failure_endpoint_source(") && runtimeStore.includes("endpoint_source: failure.endpoint_source.clone()") && runtimeStore.includes("trusted_connection_failure_keeps_original_endpoint_source") && runtimeStore.includes("matches!(failure.endpoint_source, super::EndpointSource::Saved)") && runtimeStore.includes("failure.endpoint_source") && runtimeStore.includes("super::EndpointSource::Discovery") && runtimeStore.includes("manual_trusted_endpoint_failure_is_labeled_manual"));
check("UI can copy audit fingerprints", appUi.includes("copyAuditFingerprint") && appUi.includes("Copy local full fingerprint") && appUi.includes("Copy full fingerprint for"));
check("UI keeps input readiness diagnostics", appUi.includes("Input readiness") && appUi.includes("Next action"));
check("UI keeps startup health diagnostics", appUi.includes("Startup health") && appUi.includes("networkHealth") && appUi.includes("startupRegistration"));
check("UI shows startup health detail strings", appUi.includes("serviceHealthDetail") && appUi.includes("startup-health-detail") && appUi.includes("status.networkHealth.controlListener") && appUi.includes("status.networkHealth.discovery"));
check("UI labels reconnect candidates without implying reachability", appUi.includes("checkableTrustedDevices") && appUi.includes("ready for checks") && appUi.includes("known endpoint") && !appUi.includes('"trusted endpoint")} reachable'));
check("UI uses full permission labels", appUi.includes("Accessibility") && appUi.includes("Input Monitoring"));
check("UI keeps input transport empty state", appUi.includes("No input events yet") && appUi.includes("Input Transport"));
check("UI labels input transport direction for smoke evidence", appUi.includes("inputEventDirectionLabel") && appUi.includes("\"Incoming\"") && appUi.includes("\"Outgoing\"") && appUi.includes("inputEventDirectionLabel(event)"));
check("UI labels input transport status for smoke evidence", appUi.includes("inputEventStatusLabel") && appUi.includes("\"Accepted\"") && appUi.includes("\"Failed\"") && appUi.includes("\"Rejected\"") && appUi.includes("inputEventStatusLabel(event)"));
check("UI shows input event device and time evidence", appUi.includes("inputEventDeviceLabel") && appUi.includes("elapsedLabel(event.atMs)") && appUi.includes("event.deviceId"));
check("UI shows input transport failure reason evidence", runtimeStore.includes("pub detail: Option<String>") && runtimeStore.includes("event.detail.as_deref()") && appUi.includes("inputEventDetailLabel") && appUi.includes("Reason: ${event.detail}") && appUi.includes("event-copy") && appUi.includes("event-detail") && networkingMilestone.includes("Incoming input failures, including authentication failure and native injection failure, are retained in the input transport history"));
check("UI surfaces failed Tauri network commands", appUi.includes("invokeNetworkAction") && appUi.includes("commandErrorMessage") && appUi.includes("failed: ${commandErrorMessage(error)}") && networkingMilestone.includes("User-triggered Tauri network command failures are also converted into visible action messages"));
check("UI requires typed pairing code before confirm", appUi.includes("pairingCodeEntries") && appUi.includes("Other code") && appUi.includes("pairingCodeEntryState") && appUi.includes("Code mismatch") && appUi.includes("Expired; start again") && appUi.includes("pairingNowMs >= pairing.expiresAtMs") && appUi.includes("disabled={!entryState.canConfirm}") && networkingMilestone.includes("Confirm` disabled until the typed six-digit code") && networkingMilestone.includes("expired pending pairing rows visibly disabled"));
check("UI labels pairing direction for smoke evidence", appUi.includes("pairingDirectionLabel") && appUi.includes("\"Incoming\"") && appUi.includes("\"Outgoing\"") && appUi.includes("pairingDirectionLabel(pairing)"));
check("UI gates trusted reconnect checks when disabled", appUi.includes("reconnectChecksAvailable") && appUi.includes("Turn on Auto reconnect before checking trusted devices") && appUi.includes("disabled={!status.trustedReconnect}"));
check("UI labels manual endpoint source as manual IP", appUi.includes('if (device.endpointSource === "manual") return "manual IP"') && runtimeStore.includes("record_verified_manual_trusted_endpoint") && runtimeStore.includes("verified_manual_trusted_endpoint_is_labeled_manual") && runtimeStore.includes("manual_trusted_endpoint_failure_is_labeled_manual"));
check("Networking milestone documents delayed manual endpoint persistence", networkingMilestone.includes("only after the target replies with a valid remote pairing acknowledgement"));
check("Runtime does not expose unverified manual endpoint persistence", !runtimeStore.includes("record_manual_connect") && !fs.readFileSync("src-tauri/src/lib.rs", "utf8").includes("manual_connect"));
check("Networking milestone documents self-pair rejection", networkingMilestone.includes("rejects self-pairing attempts"));
check("Networking milestone documents local-only endpoint rejection", networkingMilestone.includes("rejects local-only endpoints") && networkingMilestone.includes("localhost.localdomain") && networkingMilestone.includes("loopback addresses") && networkingMilestone.includes("port `0`"));
check("Networking milestone documents manual endpoint UI hint", networkingMilestone.includes("manual endpoint field states") && networkingMilestone.includes("localhost, loopback, unspecified, and link-local IPv6 endpoints are rejected"));
check("Networking milestone documents unscoped link-local IPv6 endpoint rejection", networkingMilestone.includes("unscoped link-local IPv6") && networkingMilestone.includes("not advertised or accepted"));
check("Networking milestone documents reconnect recovery hints", networkingMilestone.includes("recovery hints for stale saved endpoints") && networkingMilestone.includes("Trusted checks, test input sends, endpoint verification failures, and capture forwarding failures append the same `Set IP` / `Verify IP` recovery hint") && networkingMilestone.includes("Trusted devices with input control ready can open the endpoint field") && networkingMilestone.includes("`Edit IP` or `Set IP`") && networkingMilestone.includes("authenticated ping") && networkingMilestone.includes("without re-pairing") && networkingMilestone.includes("no previously saved endpoint"));
check("Networking milestone documents stale no-endpoint manual re-pair", networkingMilestone.includes("stale trusted records without an endpoint") && networkingMilestone.includes("manual re-pair flow") && networkingMilestone.includes("paste the peer's copied endpoint") && networkingMilestone.includes("confirm a new code"));
check("Networking milestone documents reconnect endpoint fallback", networkingMilestone.includes("ordered endpoint candidates") && networkingMilestone.includes("saved endpoint"));
check("Networking milestone documents startup network health", networkingMilestone.includes("startup network health") && networkingMilestone.includes("last trusted reconnect attempt") && networkingMilestone.includes("TCP, UDP, and start-at-login detail strings"));
check("Networking milestone documents reconnect retry reset on endpoint changes", networkingMilestone.includes("Reconnect backoff is tied to the current ordered endpoint candidates") && networkingMilestone.includes("retries immediately"));
check("Networking milestone documents wake-like reconnect retry reset", networkingMilestone.includes("wake-like scheduler delay") && networkingMilestone.includes("old exponential backoff"));
check("Networking milestone documents saved endpoint startup cleanup", networkingMilestone.includes("normalized on startup") && networkingMilestone.includes("old state does not poison reconnect attempts"));
check("Networking milestone documents manual check endpoint fallback", networkingMilestone.includes("manual reconnect check") && networkingMilestone.includes("same ordered endpoint candidates"));
check("Networking milestone documents reconnect check gating", networkingMilestone.includes("Manual and bulk reconnect check controls are disabled") && networkingMilestone.includes("backend command rejects direct check requests"));
check("Networking milestone documents test input endpoint fallback", networkingMilestone.includes("test input event") && networkingMilestone.includes("`key press r`") && networkingMilestone.includes("same ordered endpoint candidates as trusted reconnect"));
check("Networking milestone documents acknowledged test input", networkingMilestone.includes("waits for an authenticated receiver acknowledgement") && networkingMilestone.includes("disabled receive permissions or injection failures"));
check("Networking milestone documents input event evidence context", networkingMilestone.includes("source device, and relative time") && networkingMilestone.includes("smoke-test evidence"));
check("Networking milestone documents input success health refresh", networkingMilestone.includes("Successful acknowledged test input delivery also refreshes trusted connection health") && networkingMilestone.includes("Successful acknowledged capture delivery also refreshes trusted connection health"));
check("Networking milestone documents recent trusted endpoint fallbacks", networkingMilestone.includes("bounded newest-first list of recent verified endpoints") && networkingMilestone.includes("one stale saved address does not immediately erase other working fallback addresses"));
check("Networking milestone documents capture endpoint fallback", networkingMilestone.includes("Capture forwarding uses the same ordered endpoint candidates") && networkingMilestone.includes("every active target candidate fails"));
check("Networking milestone documents active capture timing evidence", networkingMilestone.includes("active capture target plus elapsed start time"));
check("Networking milestone documents acknowledged capture forwarding", networkingMilestone.includes("Each forwarded capture event waits for an authenticated receiver acknowledgement") && networkingMilestone.includes("disabled receive permissions or injection failures stop capture"));
check("Networking milestone distinguishes Wi-Fi bands from cellular 4G/5G", networkingMilestone.includes("Cellular 4G/5G is different from 2.4/5 GHz Wi-Fi"));
check("Networking milestone scopes discovery to IPv4 LAN MVP", networkingMilestone.includes("IPv4 UDP broadcast") && networkingMilestone.includes("IPv6 discovery is not part of the MVP yet"));
check("Networking milestone documents IPv6 manual listener support", networkingMilestone.includes("manual IPv6 endpoints can be reached") && networkingMilestone.includes("IPv4-mapped IPv6 peers"));
check("Networking milestone documents copyable IPv6 endpoints", networkingMilestone.includes("copy local IPv4 and IPv6 control endpoints") && networkingMilestone.includes("unique-local IPv6") && networkingMilestone.includes("Link-local IPv6 endpoints are not advertised"));
check("Networking milestone documents private local secret storage gap", networkingMilestone.includes("private local JSON") && networkingMilestone.includes("OS keychain"));
check("Networking milestone documents public-key identity fingerprints", networkingMilestone.includes("persisted X25519 identity public key") && networkingMilestone.includes("pre-keypair local state migrates"));
check("Networking milestone documents peer public key trust", networkingMilestone.includes("identity public key") && networkingMilestone.includes("Trusted device records store the peer identity public key"));
check("Networking milestone documents role capabilities", networkingMilestone.includes("local role: `Main`, `Client`, or `Both`") && networkingMilestone.includes("`Main` and `Both` can send") && networkingMilestone.includes("`Client` and `Both` can receive") && networkingMilestone.includes("trusted-device records carry the peer role") && networkingMilestone.includes("Device, pending-pairing, and trusted-device audit rows display the peer role"));
check("Networking milestone documents private inbound guard", networkingMilestone.includes("rejects non-private remote addresses by default"));
check("Networking milestone documents receive shortcut", networkingMilestone.includes("receive shortcut") && networkingMilestone.includes("global incoming-control gate") && networkingMilestone.includes("individual toggles"));
check("Networking milestone documents stale receive toggle gating", networkingMilestone.includes("Per-device Receive toggles are disabled for stale trusted records") && networkingMilestone.includes("shared input secret exists"));
check("Networking milestone documents endpoint prioritization", networkingMilestone.includes("private IPv4 LAN addresses appear before link-local or public") && networkingMilestone.includes("unique-local addresses before global"));
check("Networking milestone documents full fingerprint copy", networkingMilestone.includes("copy button for the full fingerprint"));
check("Networking milestone documents trusted-device audit view", networkingMilestone.includes("trusted-device audit view") && networkingMilestone.includes("local public-key fingerprint") && networkingMilestone.includes("last failure") && networkingMilestone.includes("same recovery hint shown in the device row") && networkingMilestone.includes("copied directly from the audit view"));
check("Networking milestone documents interface binding gap", networkingMilestone.includes("listener binds all interfaces") && networkingMilestone.includes("per-interface allowlists"));
check("Networking milestone documents Windows punctuation injection", networkingMilestone.includes("common punctuation captured from macOS"));
check("Networking milestone documents Windows absolute coordinate scaling", networkingMilestone.includes("full 0..65535"));
check("Networking milestone documents modifier, arrow, and navigation key input", networkingMilestone.includes("modifier key down/up events from `flagsChanged`") && networkingMilestone.includes("modifier keys, arrow/navigation keys") && networkingMilestone.includes("Return/Enter"));
check("Architecture documents X25519 pairing", architecture.includes("ephemeral X25519 key exchange"));
check("Architecture documents persisted identity keypair", architecture.includes("persisted X25519 identity keypair") && architecture.includes("identity public key plus its fingerprint"));
check("Architecture documents authenticated trusted messages", architecture.includes("AEAD-encrypted envelope") && architecture.includes("current ping challenge"));
check("Architecture documents encrypted trusted frames", architecture.includes("AEAD-encrypted envelope") && networkingMilestone.includes("ChaCha20-Poly1305") && networkingMilestone.includes("pair approvals, trusted reconnect ping/pong, input events, and trusted acknowledgements are encrypted"));
check("Architecture documents private inbound guard", architecture.includes("rejects public remote addresses"));
check("Architecture documents quoted Windows startup path", architecture.includes("quoted executable path"));
check("Cargo enables X25519 dependency", cargoToml.includes("x25519-dalek") && cargoToml.includes("static_secrets"));
check("Cargo enables AEAD dependency", cargoToml.includes("chacha20poly1305"));
check("Runtime rejects explicit pairing failures", networkRuntime.includes("ControlMessage::PairRejected"));
check("Runtime uses X25519 pairing key agreement", networkRuntime.includes("dh_public_key") && runtimeStore.includes("local_dh_private_key") && runtimeStore.includes("pairing_dh_public_key_is_well_formed") && cryptoRuntime.includes("x25519_public_key_well_formed_requires_32_byte_hex") && networkRuntime.includes("Pairing acknowledgement used an invalid key exchange public key") && networkRuntime.includes("Pairing request used an invalid key exchange public key") && networkingMilestone.includes("Pair requests and acknowledgements reject malformed ephemeral X25519 public keys"));
check("Runtime uses public-key identity fingerprints", identityRuntime.includes("identity_private_key") && identityRuntime.includes("identity_public_key") && identityRuntime.includes("fingerprint_from_public_key"));
check("Runtime persists and advertises local computer role", identityRuntime.includes("pub enum ComputerRole") && identityRuntime.includes("pub role: ComputerRole") && runtimeStore.includes("mode: persisted.settings.role.clone()") && runtimeStore.includes("role: state.persisted.settings.role.clone()") && runtimeStore.includes("local_role_setting_updates_status_and_announcement"));
check("Runtime persists trusted peer role through pairing", identityRuntime.includes("pub role: ComputerRole") && runtimeStore.includes("pub role: ComputerRole") && runtimeStore.includes("role: peer.role") && runtimeStore.includes("role: pairing.role.clone()") && runtimeStore.includes("role: device.role.clone()"));
check("Runtime persists trusted reconnect setting across restart", runtimeStore.includes("trusted_reconnect_setting_persists_after_restart") && runtimeStore.includes("trusted_reconnect: Some(false)") && runtimeStore.includes("trusted_reconnect: Some(true)"));
check("Runtime enforces local role send and receive capabilities", identityRuntime.includes("can_send_input") && identityRuntime.includes("can_receive_input") && runtimeStore.includes("input_sending_enabled") && runtimeStore.includes("client_role_cannot_start_capture") && runtimeStore.includes("main_role_rejects_incoming_input_even_when_receive_toggles_are_on") && networkRuntime.includes("Set this computer role to Main or Both before sending test input"));
check("Runtime advertises and stores peer identity public keys", runtimeStore.includes("pub public_key: String") && runtimeStore.includes("identity.identity_public_key") && runtimeStore.includes("device.public_key = non_empty_public_key"));
check("Runtime validates advertised public keys against fingerprints", runtimeStore.includes("peer_public_key_matches_fingerprint") && runtimeStore.includes("Pairing public key does not match fingerprint") && runtimeStore.includes("Accepted pairing public key does not match fingerprint"));
check("Runtime binds remote pairing approvals to pending public keys", runtimeStore.includes("Accepted pairing public key does not match.") && runtimeStore.includes("remote_pairing_approval_requires_matching_public_key") && networkingMilestone.includes("Remote pairing approvals must match the pending pairing's device ID, comparison code, fingerprint, and advertised identity public key"));
check("Runtime rolls back remote approval when pairing completion fails", runtimeStore.includes("pairing.remote_approved = false") && runtimeStore.includes("completed_pairing_rejects_public_trusted_endpoint_while_guard_is_on") && runtimeStore.includes("!pairing.remote_approved") && runtimeStore.includes("pairing.endpoint == \"192.168.1.50:44777\"") && networkingMilestone.includes("Remote pairing approvals validate the replied endpoint before mutating the pending pairing"));
check("Runtime matches stored peer public keys for trusted input and reconnect", runtimeStore.includes("trusted_device_matches_source") && runtimeStore.includes("trusted_identity_matches") && runtimeStore.includes("Rejected input event because trusted identity does not match") && networkRuntime.includes("Rejected reconnect ping because trusted identity does not match") && networkRuntime.includes("public_key: reconnect_target.public_key.clone()") && networkRuntime.includes("peer_public_key_matches_fingerprint") && networkRuntime.includes("reconnect_pong_requires_matching_public_key_when_stored") && runtimeStore.includes("trusted_discovery_requires_stored_public_key_match"));
check("Network encrypts shared-secret control messages", cryptoRuntime.includes("encrypt_control_payload") && cryptoRuntime.includes("decrypt_control_payload") && networkRuntime.includes("EncryptedControlMessage") && networkRuntime.includes("control_envelope_for_message") && networkRuntime.includes("trusted_control_envelope_encrypts_shared_secret_messages") && networkRuntime.includes("received_control_message_from_envelope") && networkRuntime.includes("encrypted_key_matches_message") && networkRuntime.includes("accept_encrypted"));
check("Runtime migrates legacy identity state to keypair", identityRuntime.includes("ensure_identity_keypair") && identityRuntime.includes("older_state_migrates_to_identity_keypair_on_load"));
check("Crypto derives fingerprints from public key bytes", cryptoRuntime.includes("fingerprint_from_public_key") && cryptoRuntime.includes("hex32(public_key)") && cryptoRuntime.includes("fingerprint_is_derived_from_public_key_bytes"));
check("Runtime authenticates pairing approval", networkRuntime.includes("pending_pairing_shared_secret") && networkRuntime.includes("Pairing approval rejected: authentication failed"));
check("Runtime exposes atomic receive shortcut", runtimeStore.includes("enable_receive_for_trusted_devices") && runtimeStore.includes("Receive enabled for {ready_count} trusted device") && runtimeStore.includes("receive_shortcut_enables_global_and_trusted_device_permissions") && tauriAppRuntime.includes("enable_receive_for_trusted_devices"));
check("Runtime receive shortcut skips stale trusted devices", runtimeStore.includes("Re-pair a trusted device before enabling receive") && runtimeStore.includes("receive_shortcut_rejects_stale_trusted_devices") && runtimeStore.includes("device.shared_secret.is_some()") && networkingMilestone.includes("Stale trusted devices that need re-pairing are skipped by the shortcut"));
check("Runtime per-device receive updates enforce role and input-secret readiness", runtimeStore.includes("device_receive_permission_requires_receive_role_and_input_secret") && runtimeStore.includes("Set this computer role to Client or Both before enabling receive.") && runtimeStore.includes("Re-pair this device before enabling receive.") && networkingMilestone.includes("Direct per-device receive updates are also rejected unless this computer can receive input and the selected trusted device has a shared input secret"));
check("Runtime reports specific incoming receive-toggle failures", runtimeStore.includes("Allow incoming control is off") && runtimeStore.includes("Receive is off for this trusted device") && runtimeStore.includes("global_off.message") && runtimeStore.includes("device_off.message") && networkingMilestone.includes("distinguish missing `Allow incoming control` from a per-device `Receive` toggle"));
check("Runtime binds pong to ping challenge", networkRuntime.includes("challenge: response_challenge") && networkRuntime.includes("response_challenge == challenge") && networkRuntime.includes("Authenticated reconnect replied with a stale challenge.") && networkingMilestone.includes("reconnect diagnostics distinguish a stale challenge from a wrong trusted identity"));
check("Runtime tries reconnect endpoint candidates before backoff", networkRuntime.includes("trusted_reconnect_targets") && networkRuntime.includes("for endpoint in endpoints.clone()"));
check("Runtime keeps recent trusted endpoint candidates", runtimeStore.includes("recent_endpoints") && runtimeStore.includes("MAX_RECENT_TRUSTED_ENDPOINTS") && runtimeStore.includes("saved_trusted_endpoints") && runtimeStore.includes("remember_trusted_endpoint"));
check("Runtime ignores late trusted health for forgotten devices", runtimeStore.includes("trusted_connection_recording_ignores_unknown_device_without_ghost_health") && runtimeStore.includes("position(|device| device.id == device_id)") && networkingMilestone.includes("cannot leave ghost trusted state behind"));
check("Runtime ignores stale or late trusted failures", runtimeStore.includes("trusted_connection_failure_ignores_unknown_device_without_ghost_failure") && runtimeStore.includes("stale_trusted_connection_failures_are_pruned_from_status") && runtimeStore.includes(".any(|device| device.id == device_id)") && networkingMilestone.includes("late reconnect/input failures for a device that has already been forgotten are ignored"));
check("Runtime clears matching stale trusted failure on discovery", runtimeStore.includes("trusted_discovery_clears_matching_stale_connection_failure") && runtimeStore.includes("trusted_discovery_keeps_different_endpoint_failure_visible") && runtimeStore.includes("connection_failures.remove(&announcement.device_id)") && networkingMilestone.includes("trusted LAN discovery sees the same peer at the same endpoint again") && networkingMilestone.includes("without leaving a stale warning after auto-discovery proves that endpoint is back"));
check("Runtime normalizes trusted failure endpoints for status evidence", runtimeStore.includes("trusted_connection_failure_normalizes_endpoint_for_status") && runtimeStore.includes("let Some(endpoint) = normalized_endpoint(endpoint)") && networkingMilestone.includes("Failed endpoint values are normalized before they are shown in status") && networkingMilestone.includes("malformed or local-only failed endpoint values are discarded"));
check("Runtime prunes stale health before trusted failure source labels", runtimeStore.includes("record_trusted_connection_failure") && runtimeStore.includes("prune_runtime_state(&mut state, now_ms())") && runtimeStore.includes("trusted_connection_failure_prunes_stale_health_before_source_label") && runtimeStore.includes("matches!(failure.endpoint_source, super::EndpointSource::Saved)"));
check("Runtime prunes stale health before trusted target selection", runtimeStore.includes("trusted_target_selection_prunes_stale_health") && runtimeStore.includes("pub fn trusted_reconnect_targets") && runtimeStore.includes("pub fn trusted_target(&self") && runtimeStore.includes("pub fn active_capture_target") && runtimeStore.includes("prune_runtime_state(&mut state, now_ms())"));
check("Runtime forget cleanup removes trusted transient state", runtimeStore.includes("forget_trusted_device_clears_runtime_state_for_that_device") && runtimeStore.includes("state.connection_health.remove(&request.device_id)") && runtimeStore.includes("state.connection_failures.remove(&request.device_id)") && runtimeStore.includes(".input_events") && runtimeStore.includes(".retain(|event| event.device_id != request.device_id)") && runtimeStore.includes(".pending_pairings") && runtimeStore.includes(".remove(&pairing_id(&request.device_id))") && networkingMilestone.includes("forgetting clears live health, last failure, pending pairing state, input transport history, and active capture state"));
check("Runtime retries reconnect immediately when endpoint candidates change", networkRuntime.includes("reconnect_retry_should_wait") && networkRuntime.includes("retry.endpoints == target.endpoints") && networkRuntime.includes("reconnect_retry_resets_when_endpoint_candidates_change"));
check("Runtime schedules reconnect retry from loop timestamp", networkRuntime.includes("schedule_reconnect_retry(&mut retry_state, &device_id, endpoints, now)") && networkRuntime.includes("entry.next_attempt_at = now + delay") && networkRuntime.includes("reconnect_retry_schedules_from_loop_timestamp"));
check("Runtime retries reconnect immediately after wake-like loop delay", networkRuntime.includes("RECONNECT_WAKE_RESET_GRACE") && networkRuntime.includes("reconnect_loop_should_reset_after_delay") && networkRuntime.includes("retry_state.clear()") && networkRuntime.includes("reconnect_retry_resets_after_wake_like_loop_delay"));
check("Manual reconnect check uses endpoint candidates", networkRuntime.includes("pub async fn check_trusted_device") && networkRuntime.includes(".find(|target| target.device_id == request.device_id)"));
check("Manual reconnect check respects reconnect setting", networkRuntime.includes("pub async fn check_trusted_device") && networkRuntime.includes("!store.trusted_reconnect_enabled()") && networkRuntime.includes("Turn on Auto reconnect before running trusted checks."));
check("Test input send uses endpoint candidates", networkRuntime.includes("pub async fn send_test_input") && networkRuntime.includes("InputAck") && networkRuntime.includes("send_control_message_for_response_with_secret") && networkRuntime.includes("Some(&reconnect_target.shared_secret)"));
check("Test input send requires authenticated receiver acknowledgement", networkRuntime.includes("InputAck { ok: true") && networkRuntime.includes("InputAck { ok: false") && networkRuntime.includes("Input event target closed before acknowledging") && networkRuntime.includes("input_ack_round_trip_requires_authentication"));
check("Test input event is a visible key tap", runtimeStore.includes("test_input_event_is_visible_key_tap") && runtimeStore.includes("key: Some(\"r\".to_string())") && runtimeStore.includes("key press r"));
check("Runtime input summaries cover capture smoke event categories", runtimeStore.includes("input_summary_covers_capture_smoke_event_categories") && runtimeStore.includes("mouse move 320,240") && runtimeStore.includes("mouse up primary") && runtimeStore.includes("scroll -1") && runtimeStore.includes("key down enter"));
check("Runtime ignores late outgoing input audit for forgotten devices", runtimeStore.includes("outgoing_input_record_ignores_unknown_device_without_ghost_audit") && runtimeStore.includes("record_outgoing_input") && runtimeStore.includes(".any(|device| device.id == device_id)") && networkingMilestone.includes("cannot leave ghost input evidence for removed trust"));
check("Test input send refreshes trusted health", networkRuntime.includes("pub async fn send_test_input") && networkRuntime.includes("store.record_trusted_connection(") && networkRuntime.includes("request.device_id.clone()") && networkRuntime.includes("endpoint.clone()"));
check("Accepted incoming input refreshes trusted source health", networkRuntime.includes("record_successful_input_source") && networkRuntime.includes("accepted_incoming_input_refreshes_source_health") && networkRuntime.includes("accepted_incoming_input_rejects_invalid_source_control_port") && networkRuntime.includes("source_endpoint(sender, source.control_port)") && networkingMilestone.includes("Accepted incoming input also refreshes the receiver's trusted connection health") && networkingMilestone.includes("Invalid advertised source control ports are ignored"));
check("Incoming input auth and identity failures record trusted source failure", networkRuntime.includes("record_auth_failed_input_source") && networkRuntime.includes("authenticated_input_failure_records_source_failure") && networkRuntime.includes("authenticated_input_failure_ignores_invalid_source_control_port") && networkRuntime.includes("unauthenticated_unknown_input_does_not_create_input_audit") && networkRuntime.includes("incoming_input_identity_failure_records_source_failure_without_input_audit") && networkRuntime.includes("if !store.trusted_identity_matches(&source)") && networkingMilestone.includes("Incoming input authentication and trusted-identity failures from a trusted device ID are also recorded as trusted-device failures") && networkingMilestone.includes("unknown/no-secret sources are rejected without creating ghost smoke evidence") && networkingMilestone.includes("Authenticated identity failures are rejected before an input transport row is recorded"));
check("Incoming reconnect auth failures record trusted source failure", networkRuntime.includes("record_failed_reconnect_source") && networkRuntime.includes("authenticated_reconnect_failure_records_source_failure") && networkRuntime.includes("authenticated_reconnect_failure_ignores_invalid_source_control_port") && networkingMilestone.includes("Incoming reconnect ping authentication failures and trusted identity mismatches are also recorded as trusted-device failures"));
check("Runtime ignores invalid or public trusted failures", runtimeStore.includes("private_network_guard_ignores_public_connection_failures") && runtimeStore.includes("trusted_connection_failure_ignores_invalid_endpoints") && runtimeStore.includes("let Some(endpoint) = normalized_endpoint(endpoint)") && runtimeStore.includes("private_guard_allows_endpoint") && runtimeStore.includes("state.persisted.settings.private_network_only"));
check("Capture forwarding uses endpoint candidates", runtimeStore.includes("active_capture_target(&self) -> Option<TrustedReconnectTarget>") && networkRuntime.includes("for endpoint in &target.endpoints"));
check("Capture startup prunes stale health before endpoint check", runtimeStore.includes("start_capture_prunes_stale_health_before_endpoint_check") && runtimeStore.includes("pub fn start_capture(&self") && runtimeStore.includes("prune_runtime_state(&mut state, now_ms())") && networkingMilestone.includes("Capture startup prunes expired runtime endpoint health"));
check("Capture target resolution clears stale active capture", runtimeStore.includes("active_capture_target_clears_capture_without_usable_endpoint") && runtimeStore.includes("clear_capture_if_target_unusable(&mut state)") && networkingMilestone.includes("active target no longer has any usable endpoint after runtime cleanup"));
check("Status reporting clears stale active capture", runtimeStore.includes("status_clears_capture_without_usable_endpoint") && runtimeStore.includes("pub fn status(&self) -> RuntimeStatus") && runtimeStore.includes("clear_capture_if_target_unusable(&mut state)") && networkingMilestone.includes("status reporting also clears that stale active state"));
check("Capture forwarding requires authenticated receiver acknowledgement", networkRuntime.includes("async fn send_input_to_target") && networkRuntime.includes("send_control_message_for_response_with_secret") && networkRuntime.includes("Ok(Some(ControlMessage::InputAck { ok: true") && networkRuntime.includes("Ok(Some(ControlMessage::InputAck { ok: false") && networkRuntime.includes("capture_forwarding_requires_receiver_acknowledgement"));
check("Capture forwarding refreshes trusted health", networkRuntime.includes("send_input_to_target") && networkRuntime.includes("record_trusted_connection(target.device_id.clone(), endpoint.clone(), None)"));
check("Trusted endpoint failures include recovery hint", networkRuntime.includes("TRUSTED_ENDPOINT_RECOVERY_HINT") && networkRuntime.includes("trusted_endpoint_recovery_message") && networkRuntime.includes("use Set IP, then Verify IP") && networkRuntime.includes("trusted_endpoint_recovery_message_adds_set_ip_hint_once"));
check("Runtime rejects public inbound control by default", networkRuntime.includes("is_private_or_local_address") && runtimeStore.includes("private_network_only"));
check("Runtime binds IPv4 and IPv6 control listeners", networkRuntime.includes("TcpSocket") && networkRuntime.includes("SocketAddr::V6") && networkRuntime.includes("\"IPv4\""));
check("Runtime normalizes IPv4-mapped IPv6 control peers", networkRuntime.includes("to_ipv4_mapped()"));
check("Runtime tests pong challenge matching", networkRuntime.includes("wrong_challenge") && networkRuntime.includes("ping-challenge"));
check("Runtime tests private network guard ranges", networkRuntime.includes("private_network_guard_allows_private_and_local_addresses") && networkRuntime.includes("private_network_guard_rejects_public_addresses"));
check("Runtime clears public saved endpoints when private guard is enabled", runtimeStore.includes("sanitize_endpoint_for_private_guard") && runtimeStore.includes("enabling_private_network_guard_clears_saved_public_endpoint_literals") && networkingMilestone.includes("after the guard is turned back on"));
check("Runtime prioritizes private local endpoints", networkRuntime.includes("local_ipv4_endpoint_priority") && networkRuntime.includes("local_ipv6_endpoint_priority") && networkRuntime.includes("local_endpoint_priority_prefers_private_lan_addresses"));
check("Runtime parses local IPv6 endpoints", networkRuntime.includes("parse_ifconfig_local_ipv6_addresses") && networkRuntime.includes("parse_ipconfig_local_ipv6_addresses"));
check("Runtime omits link-local IPv6 copy endpoints", networkRuntime.includes("copyable_ipv6_endpoints_skip_link_local_addresses") && networkRuntime.includes("!is_ipv6_unicast_link_local(address)"));
check("Input runtime maps Windows punctuation keys", inputRuntime.includes("windows_virtual_key") && inputRuntime.includes("0xbb") && inputRuntime.includes("0xdd"));
check("Input runtime maps modifier, arrow, and navigation keys", inputRuntime.includes("\"shift\" => Some(0x10)") && inputRuntime.includes("\"meta\" | \"command\" | \"cmd\"") && inputRuntime.includes("K_CG_EVENT_FLAGS_CHANGED") && inputRuntime.includes("modifier_key") && inputRuntime.includes("\"left\" | \"arrowleft\"") && inputRuntime.includes("0x25") && inputRuntime.includes("0x7b => Some(\"left\")") && inputRuntime.includes("\"pageup\" | \"page-up\""));
check("Input runtime captures macOS Enter key", inputRuntime.includes("0x24 => Some(\"enter\")"));
check("Input runtime tests Windows key mapping", inputRuntime.includes("windows_virtual_key_maps_punctuation_captured_by_macos"));
check("Input runtime tests Windows absolute coordinate scaling", inputRuntime.includes("windows_absolute_coordinate_reaches_screen_edges"));
check("Runtime prevents self pairing", runtimeStore.includes("Cannot pair this computer with itself."));
check("Runtime binds explicit known-device endpoint pairing to selected identity", runtimeStore.includes("expected_pairing_peer_for_device") && runtimeStore.includes("pairing_peer_from_trusted_device") && runtimeStore.includes("explicit_endpoint_pairing_target_keeps_known_device_identity") && runtimeStore.includes("outgoing_pairing_registration_prefers_expected_identity_over_stale_discovery") && runtimeStore.includes("pairing_peer_matches_announcement(expected, &peer.announcement)") && runtimeStore.includes("manual_endpoint_pairing_target_without_known_device_learns_identity_from_ack") && networkRuntime.includes("expected_peer.public_key != peer.public_key") && networkingMilestone.includes("explicit known-device endpoint pairings must match the selected device ID and fingerprint") && networkingMilestone.includes("registration prefers the selected expected identity"));
check("Runtime rejects stale discovery-only pairing targets", runtimeStore.includes("stale_discovered_pairing_target_is_rejected") && runtimeStore.includes("explicit_endpoint_pairing_target_ignores_stale_discovery_identity") && runtimeStore.includes("peer_is_fresh(peer, now)") && networkingMilestone.includes("Retained stale discovery records cannot start pairing"));
check("Runtime rejects local-only manual endpoints", runtimeStore.includes("rejects_local_only_manual_endpoints") && runtimeStore.includes("socket_address_is_local_only") && runtimeStore.includes("hostname_is_local_only"));
check("Runtime rejects unscoped link-local IPv6 manual endpoints", runtimeStore.includes("rejects_unscoped_link_local_ipv6_manual_endpoints") && runtimeStore.includes("ipv6_is_unscoped_link_local") && runtimeStore.includes("unscoped_link_local_ipv6_saved_endpoints_are_sanitized_on_startup"));
check("Runtime rejects malformed manual hostnames", runtimeStore.includes("rejects_invalid_manual_hostnames") && runtimeStore.includes("valid_hostname_label") && runtimeStore.includes("macbook..local"));
check("Runtime canonicalizes manual hostname endpoints", runtimeStore.includes("canonical_hostname") && runtimeStore.includes("canonicalizes_host_with_port") && runtimeStore.includes("MacBook.LOCAL.:44778") && networkingMilestone.includes("Hostname endpoints are canonicalized to lowercase without a trailing dot"));
check("Runtime requires endpoint-only pairing requests to be manual", runtimeStore.includes("Endpoint-only pairing requests must be marked as manual pairing") && runtimeStore.includes("endpoint_only_pairing_target_requires_manual_flag") && networkingMilestone.includes("Endpoint-only pairing requests must be marked as manual pairing"));
check("Runtime rejects invalid socket ports", runtimeStore.includes("rejects_invalid_ports") && runtimeStore.includes("[fd12:3456:789a::10]:0") && runtimeStore.includes("address.port() == 0"));
check("Runtime gives explicit invalid manual pairing endpoint errors", runtimeStore.includes("INVALID_ENDPOINT_MESSAGE") && runtimeStore.includes("pairing_target_rejects_invalid_manual_endpoint_with_specific_message"));
check("Runtime sanitizes saved endpoints on startup", runtimeStore.includes("sanitize_persisted_endpoints") && runtimeStore.includes("saved_endpoints_are_sanitized_on_startup") && runtimeStore.includes("saved_endpoints_are_normalized_on_startup"));
check("Runtime tests recent trusted endpoint fallback storage", runtimeStore.includes("saved_recent_trusted_endpoints_are_normalized_bounded_and_prioritized") && runtimeStore.includes("trusted_connection_recording_keeps_recent_endpoint_fallbacks"));
check("Runtime validates trusted endpoint recording", runtimeStore.includes("trusted_connection_recording_normalizes_and_rejects_invalid_endpoints") && runtimeStore.includes("public trusted endpoint should be rejected while guard is on") && runtimeStore.includes("completed_pairing_normalizes_trusted_endpoint_before_saving") && runtimeStore.includes("completed_pairing_rejects_invalid_trusted_endpoint") && runtimeStore.includes("completed_pairing_rejects_public_trusted_endpoint_while_guard_is_on") && runtimeStore.includes("completed_pairing_save_failure_does_not_trust_device_in_memory") && runtimeStore.includes("trusted_connection_save_failure_does_not_update_runtime_endpoint") && runtimeStore.includes("completed_repair_clears_stale_connection_state") && runtimeStore.includes("record_trusted_connection") && runtimeStore.includes("normalized_endpoint(&endpoint)") && runtimeStore.includes("normalized_endpoint(&pairing.endpoint)") && networkingMilestone.includes("failed local save cannot leave a device trusted only until restart") && networkingMilestone.includes("failed local save does not leave misleading reachable-state evidence"));
check("Runtime supports trusted endpoint verification without saved endpoint", runtimeStore.includes("trusted_target_for_endpoint") && runtimeStore.includes("trusted_endpoint_update_target_does_not_require_saved_endpoint"));
check("Runtime exposes startup network health", runtimeStore.includes("NetworkHealthStatus") && runtimeStore.includes("record_control_listener_health") && runtimeStore.includes("record_discovery_health") && runtimeStore.includes("record_reconnect_attempt"));
check("Network records manual reconnect attempts in startup health", reconnectAttemptCalls >= 3 && networkingMilestone.includes("Background reconnect, manual `Check`, and trusted endpoint `Verify IP` attempts all refresh this reconnect-attempt timestamp"));
check("Runtime exposes start-at-login health", runtimeStore.includes("startup_registration") && runtimeStore.includes("record_startup_registration") && runtimeStore.includes("sync_startup_registration") && runtimeStore.includes("startup_registration_health_is_reported_in_status") && runtimeStore.includes("startup_registration_sync_reports_saved_enabled_state") && runtimeStore.includes("startup_registration_sync_reports_saved_disabled_state") && runtimeStore.includes("startup_registration_sync_failure_reports_failed_health") && appUi.includes("startupRegistration") && appUi.includes("Start {statusValueLabel(status.networkHealth.startupRegistration.state)}"));
check("Runtime supports trusted endpoint update requests", runtimeStore.includes("DeviceEndpointUpdateRequest") && runtimeStore.includes("pub endpoint: String"));
check("Network verifies trusted endpoint updates before saving", networkRuntime.includes("update_trusted_endpoint") && networkRuntime.includes("trusted_target_for_endpoint") && networkRuntime.includes("reconnect_pong_matches") && networkRuntime.includes("record_verified_manual_trusted_endpoint") && networkRuntime.includes("record_manual_trusted_connection_failure") && networkRuntime.includes("Trusted endpoint updated and verified"));
check("Network records listener and reconnect startup health", networkRuntime.includes("record_control_listener_health") && networkRuntime.includes("record_discovery_health") && networkRuntime.includes("record_reconnect_attempt"));
check("Runtime prunes expired pending pairings before status or shared-secret use", runtimeStore.includes("status_prunes_expired_pending_pairing_rows") && runtimeStore.includes("pending_pairing_shared_secret_rejects_expired_pairing") && runtimeStore.includes("Pairing request expired. Start pairing again.") && runtimeStore.includes("state.pending_pairings.remove(pairing_id)") && runtimeStore.includes("prune_runtime_state(&mut state, now_ms())") && networkingMilestone.includes("Pending requests expire after 120 seconds and are pruned from runtime state, including status snapshots used by the UI") && networkingMilestone.includes("Shared-secret lookup rejects and removes expired pending pairings"));
check("Runtime status ordering is covered by regression tests", runtimeStore.includes("status_sorts_devices_deterministically") && runtimeStore.includes("status_sorts_pending_pairings_deterministically") && /right\s*\.trusted/.test(runtimeStore) && /right\s*\.online/.test(runtimeStore) && /left\s*\.expires_at_ms/.test(runtimeStore) && networkingMilestone.includes("Runtime status returns devices and pending pairings in deterministic order"));
check("Runtime removes pending pairing when manual endpoint save fails", networkRuntime.includes("remove_pending_pairing(&id)"));
check("Runtime removes incoming pending pairing when pair acknowledgement fails", networkRuntime.includes("let pairing_id = match store.register_incoming_pairing") && networkRuntime.includes("store.remove_pending_pairing(&pairing_id)") && runtimeStore.includes("incoming_pending_pairing_can_be_removed_after_ack_failure") && networkingMilestone.includes("receiver removes that pending request"));
check("Runtime rejects invalid incoming pairing endpoints before acknowledgement", runtimeStore.includes("incoming_pairing_rejects_invalid_or_public_endpoint_before_ack") && runtimeStore.includes("invalid incoming endpoint should be rejected before ack") && runtimeStore.includes("public incoming endpoint should be rejected before ack"));
check("Runtime applies persisted state changes after successful saves", runtimeStore.includes("settings_save_failure_does_not_mutate_runtime_settings") && runtimeStore.includes("auto_start_save_failure_does_not_mutate_runtime_setting_or_ready_health") && runtimeStore.includes("auto_start_registration_failure_does_not_mutate_runtime_setting") && runtimeStore.includes("manual_endpoint_save_failure_does_not_update_runtime_status") && runtimeStore.includes("clear_manual_endpoint_save_failure_keeps_runtime_status") && runtimeStore.includes("receive_shortcut_save_failure_does_not_toggle_runtime_permissions") && runtimeStore.includes("device_receive_save_failure_does_not_toggle_runtime_permission") && runtimeStore.includes("forget_trusted_device_save_failure_keeps_runtime_state") && runtimeStore.includes("state.persisted = persisted") && architecture.includes("swapped into live runtime memory only after the local save succeeds") && architecture.includes("failed saves from creating in-memory trust, endpoint, permission, or ready startup-registration state"));
check("State storage hardens Unix config permissions and save durability", fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("0o700") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("0o600") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("file.sync_all()") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("fs::rename(&temp_path, &path)") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("sync_state_parent(&path)") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("secure_state_file(&backup_path)") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("failed_state_backup_path") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("corrupt_state_backup_path_avoids_existing_backup") && fs.readFileSync("src-tauri/src/identity.rs", "utf8").includes("corrupt_state_backup_uses_private_unix_permissions") && architecture.includes("sync the parent directory on Unix") && architecture.includes("numeric suffix instead of overwriting an existing failed-state copy") && architecture.includes("Failed-state backups are also forced to private `0600` permissions"));
check("Windows autostart quotes executable path", autostartRuntime.includes("windows_run_command") && autostartRuntime.includes("format!(\"\\\"{}\\\"\""));
check("Autostart helper tests cover platform quoting", autostartRuntime.includes("macos_launch_agent_xml_escape_handles_special_chars") && autostartRuntime.includes("linux_desktop_escape_quotes_exec_path") && autostartRuntime.includes("windows_run_command_quotes_executable_path") && autostartRuntime.includes("windows_registry_missing_value_detects_missing_autostart_entry"));
check("Autostart helper tests run cross-platform", autostartRuntime.includes("#[cfg(any(test, target_os = \"macos\"))]") && autostartRuntime.includes("#[cfg(any(test, target_os = \"linux\"))]") && autostartRuntime.includes("#[cfg(any(test, target_os = \"windows\"))]") && !autostartRuntime.includes("#[cfg(target_os = \"windows\")]\n    #[test]"));
check("UI exposes failed endpoint edit recovery", appUi.includes("Edit IP") && appUi.includes("Set IP") && appUi.includes("Verify IP") && appUi.includes("update_trusted_endpoint") && appUi.includes("canEditTrustedEndpoint") && appUi.includes("Copy the current endpoint from the other computer") && appUi.includes("then use Set IP and Verify IP"));
check("UI restores manual pair field after canceling trusted IP update", appUi.includes("cancelTrustedEndpointUpdate") && appUi.includes("setManualEndpoint(status.discovery.manualEndpoint ?? \"\")") && appUi.includes("Trusted IP update canceled. Manual pair field restored."));
check("UI hides saved manual clear while verifying trusted IP", appUi.includes("status.discovery.manualEndpoint && !endpointUpdateDeviceId"));
check("UI surfaces trusted devices that need Set IP", appUi.includes("trustedDevicesNeedingEndpoint") && appUi.includes("Endpoint needed") && appUi.includes("Set IP and Verify IP"));
check("UI prioritizes reconnect failures in connection path", appUi.includes("Reconnect recovery") && appUi.includes("failedTrustedDevices.length > 0") && appUi.includes("connectionFailureHint(failedDevice)") && networkingMilestone.includes("The connection path summary prioritizes trusted reconnect failures"));
check("Installer verifier rejects unexpected platform artifacts", installerVerifier.includes("Unexpected installer artifact(s)"));
check("Installer checksum generation rejects empty installer artifacts", installerChecksums.includes("Empty installer artifact(s)"));
check("Installer checksum generation rejects wrong package-version filenames", installerChecksums.includes("packageVersion") && installerChecksums.includes("Installer filename(s) must include package version") && installerChecksumTestIncludes("wrong version installer should fail"));
check("Installer checksum generation fixture test exists", fs.existsSync("scripts/test-installer-checksums.mjs"));
check("Installer checksum generation tests valid, missing, and empty installers", installerChecksumTestIncludes("valid installers should write checksums") && installerChecksumTestIncludes("missing installers should fail") && installerChecksumTestIncludes("empty installer should fail"));
check("Installer verifier rejects empty installer artifacts", installerVerifier.includes("Empty installer artifact(s)") && installerVerifierTestIncludes("empty installer artifact should fail"));
check("Installer verifier rejects wrong package-version filenames", installerVerifier.includes("packageVersion") && installerVerifier.includes("Installer filename(s) for") && installerVerifierTestIncludes("wrong version installer artifact should fail"));
check("Installer verifier rejects stale checksum entries", installerVerifier.includes("Checksum file contains unexpected"));
check("Installer verifier rejects duplicate checksum entries", installerVerifier.includes("Duplicate checksum entry"));
check("Installer verifier tests GitHub runner OS names", installerVerifierTestIncludes("GitHub runner macOS value should pass") && installerVerifierTestIncludes("GitHub runner Windows value should pass") && installerVerifierTestIncludes("GitHub runner Linux value should pass"));
check("Installer verifier fixture test exists", fs.existsSync("scripts/test-installer-verifier.mjs"));
check("Installer verifier tests missing checksum files", installerVerifierTestIncludes("Missing checksum file"));
check("Installer verifier tests checksum mismatches", installerVerifierTestIncludes("Checksum mismatch"));
check("Publish artifact verifier script exists", fs.existsSync(publishArtifactVerifierPath));
check("Publish artifact verifier uses shared release artifact helper", publishArtifactVerifier.includes("./release-artifacts-lib.mjs"));
check("Publish artifact verifier requires all release asset types", publishArtifactVerifier.includes("Missing publish artifact type(s)") && releaseArtifactsLib.includes(".dmg") && releaseArtifactsLib.includes(".exe") && releaseArtifactsLib.includes(".deb"));
check("Publish artifact verifier requires exactly one artifact per type", publishArtifactVerifier.includes("Expected exactly one publish artifact per type") && publishArtifactVerifierTestIncludes("duplicate platform artifact type should fail"));
check("Publish artifact verifier rejects unexpected installer types", publishArtifactVerifier.includes("Unexpected publish installer artifact(s)") && releaseArtifactsLib.includes(".msi") && publishArtifactVerifierTestIncludes("unexpected installer artifact should fail"));
check("Publish artifact verifier rejects empty installer artifacts", publishArtifactVerifier.includes("Empty publish installer artifact(s)") && publishArtifactVerifierTestIncludes("empty installer artifact should fail"));
check("Publish artifact verifier fixture test exists", fs.existsSync("scripts/test-publish-artifacts.mjs"));
check("Publish artifact verifier tests missing Linux artifacts", publishArtifactVerifierTestIncludes("Missing publish artifact type(s): deb"));
check("Release asset preparation script exists", fs.existsSync(releaseAssetPreparerPath));
check("Release asset preparation uses shared release artifact helper", releaseAssetPreparer.includes("./release-artifacts-lib.mjs"));
check("Release asset preparation writes checksums and rejects duplicates", releaseAssetPreparer.includes("SHA256SUMS.txt") && releaseAssetPreparer.includes("RELEASE-MANIFEST.json") && releaseAssetPreparer.includes("Duplicate release asset filename"));
check("Release asset preparation stamps generatedAt", releaseAssetPreparer.includes("generatedAt") && releaseAssetPreparer.includes("REMOTESHARE_RELEASE_GENERATED_AT") && releaseAssetPreparerTestIncludes("Unexpected release manifest generatedAt"));
check("Release asset preparation enforces package-version filenames", releaseAssetPreparer.includes("packageVersion") && releaseAssetPreparer.includes("assertArtifactVersion") && releaseAssetPreparer.includes("Release asset filename must include package version"));
check("Release asset preparation fixture test verifies manifest", releaseAssetPreparerTestIncludes("assertManifest") && releaseAssetPreparerTestIncludes("RELEASE-MANIFEST.json") && releaseAssetPreparerTestIncludes("wrong version installer artifact should fail"));
check("Release asset preparation requires exactly one artifact per type", releaseAssetPreparer.includes("Expected exactly one publish artifact per type") && releaseAssetPreparerTestIncludes("duplicate platform artifact type should fail"));
check("Release asset preparation rejects unexpected installer types", releaseAssetPreparer.includes("Unexpected publish installer artifact(s)") && releaseArtifactsLib.includes(".msi") && releaseAssetPreparerTestIncludes("unexpected installer artifact should fail"));
check("Release asset preparation rejects empty installer artifacts", releaseAssetPreparer.includes("Empty publish installer artifact(s)") && releaseAssetPreparerTestIncludes("empty installer artifact should fail"));
check("Release asset preparation clears stale output assets", releaseAssetPreparer.includes("fs.rmSync(outputRoot") && releaseAssetPreparerTestIncludes("stale.exe"));
check("Release asset preparation prevents deleting source artifacts", releaseAssetPreparer.includes("assertDistinctOutputRoot") && releaseAssetPreparerTestIncludes("Release asset output directory must be outside"));
check("Release asset preparation fixture test exists", fs.existsSync("scripts/test-prepare-release-assets.mjs"));
check("Release asset preparation tests duplicate filenames", releaseAssetPreparerTestIncludes("Duplicate release asset filename"));
check("Release manifest verifier script exists", fs.existsSync(releaseManifestVerifierPath));
check("Release manifest verifier checks manifest and checksums", releaseManifestVerifier.includes("RELEASE-MANIFEST.json") && releaseManifestVerifier.includes("SHA256SUMS.txt"));
check("Release manifest verifier requires generatedAt timestamp", releaseManifestVerifier.includes("validateReleaseGeneratedAt") && releaseArtifactsLib.includes("generatedAt must be a valid ISO-8601 UTC timestamp") && releaseManifestVerifierTestIncludes("missing generatedAt should fail") && releaseManifestVerifierTestIncludes("invalid generatedAt should fail"));
check("Release manifest verifier enforces package-version manifest and filenames", releaseManifestVerifier.includes("manifest.version !== packageVersion") && releaseManifestVerifier.includes("validateReleaseManifestArtifact") && releaseArtifactsLib.includes("must include package version") && releaseManifestVerifierTestIncludes("wrong manifest version should fail") && releaseManifestVerifierTestIncludes("wrong artifact filename version should fail"));
check("Release manifest verifier validates one asset per platform", releaseManifestVerifier.includes("publishArtifactStatus") && releaseManifestVerifier.includes("duplicate type(s)"));
check("Release manifest verifier rejects mismatches, stale checksums, and empty artifacts", releaseManifestVerifier.includes("Manifest hash mismatch") && releaseManifestVerifier.includes("stale entry") && releaseArtifactsLib.includes("invalid sizeBytes"));
check("Release manifest verifier rejects unmanifested installer files", releaseManifestVerifier.includes("findInstallerArtifacts") && releaseManifestVerifier.includes("not present in manifest") && releaseManifestVerifier.includes("findUnexpectedInstallerArtifacts") && releaseManifestVerifierTestIncludes("extra installer should fail") && releaseManifestVerifierTestIncludes("unexpected installer should fail"));
check("Release manifest verifier fixture test exists", fs.existsSync("scripts/test-release-manifest-verifier.mjs"));
check("Release manifest verifier fixture test covers path traversal and stale checksums", releaseManifestVerifierTestIncludes("path traversal") && releaseManifestVerifierTestIncludes("stale checksum"));
check("Release artifact helper exists", fs.existsSync(releaseArtifactsLibPath));
check("Release artifact helper centralizes required and unexpected installer types", releaseArtifactsLib.includes("requiredArtifactTypes") && releaseArtifactsLib.includes(".dmg") && releaseArtifactsLib.includes(".exe") && releaseArtifactsLib.includes(".deb") && releaseArtifactsLib.includes(".msi"));
check("Release artifact helper fixture test exists", fs.existsSync("scripts/test-release-artifacts-lib.mjs"));
check("Release artifact helper fixture test covers missing and duplicate status", fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("missing deb") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("duplicate dmg"));
check("Release artifact helper fixture test covers manifest type validation", releaseArtifactsLib.includes("validateManifestArtifactTypes") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("missing manifest type") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("duplicate manifest type") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("unexpected manifest type"));
check("Release artifact helper fixture test covers manifest artifact shape and timestamp validation", releaseArtifactsLib.includes("validateReleaseManifestArtifact") && releaseArtifactsLib.includes("validateReleaseGeneratedAt") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("release manifest artifact extension") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("release manifest artifact sha256") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("release manifest artifact size") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("release manifest generatedAt date-only") && fs.readFileSync("scripts/test-release-artifacts-lib.mjs", "utf8").includes("release manifest generatedAt invalid calendar date"));
check("Disk preflight script exists", fs.existsSync("scripts/check-disk-space.mjs"));
check("Disk preflight fixture test exists", fs.existsSync("scripts/test-disk-preflight.mjs"));
check("Disk preflight default leaves space for Rust rebuilds", fs.readFileSync("scripts/check-disk-space.mjs", "utf8").includes("\"1024\""));
check("Disk preflight supports Windows runners", fs.readFileSync("scripts/check-disk-space.mjs", "utf8").includes("powershell") && fs.readFileSync("scripts/check-disk-space.mjs", "utf8").includes("pwsh"));
check("Debug cache cleanup script exists", fs.existsSync("scripts/clean-debug-cache.mjs"));
check("Debug cache cleanup preserves release bundle", cleanDebugCache.includes("target\", \"debug\", \"build") && cleanDebugCache.includes("target\", \"debug\", \"deps") && cleanDebugCache.includes("target\", \"debug\", \"incremental") && !cleanDebugCache.includes("target\", \"release"));
check("Debug cache cleanup fixture test exists", fs.existsSync("scripts/test-clean-debug-cache.mjs"));
check("Debug cache cleanup fixture test preserves release bundles", fs.readFileSync("scripts/test-clean-debug-cache.mjs", "utf8").includes("release/bundle") && fs.readFileSync("scripts/test-clean-debug-cache.mjs", "utf8").includes("Debug cache cleanup tests passed."));
check("Bundle temp cleanup script exists", fs.existsSync("scripts/clean-bundle-temp.mjs"));
check("Bundle temp cleanup removes only generated DMG temps", cleanBundleTemp.includes("rw\\..+\\.dmg") && cleanBundleTemp.includes("target\", \"release\", \"bundle") && cleanBundleTemp.includes("macos") && cleanBundleTemp.includes("dmg"));
check("Bundle temp cleanup fixture test exists", fs.existsSync("scripts/test-clean-bundle-temp.mjs"));
check("Bundle temp cleanup fixture test preserves final artifacts", fs.readFileSync("scripts/test-clean-bundle-temp.mjs", "utf8").includes("final dmg") && fs.readFileSync("scripts/test-clean-bundle-temp.mjs", "utf8").includes("final exe") && fs.readFileSync("scripts/test-clean-bundle-temp.mjs", "utf8").includes("Bundle temp cleanup tests passed."));
check("Rust formatter diagnostic script exists", fs.existsSync(rustfmtCheckerPath));
check("Rust formatter diagnostic reports broken toolchains", rustfmtChecker.includes("Rust formatter is unavailable or broken.") && rustfmtChecker.includes("rustup component add rustfmt") && rustfmtChecker.includes("REMOTESHARE_RUSTFMT_COMMAND"));
check("Rust formatter diagnostic fixture test exists", fs.existsSync(rustfmtCheckerTestPath));
check("Rust formatter diagnostic fixture tests success and broken dylib output", rustfmtCheckerTest.includes("rustfmt 1.0.0-test") && rustfmtCheckerTest.includes("Library not loaded: librustc_driver-test.dylib") && rustfmtCheckerTest.includes("JSON array of strings"));
check("CI annotation helper script exists", fs.existsSync(ciAnnotationHelperPath));
check("CI annotation helper emits GitHub errors and summaries", ciAnnotationHelper.includes("::error title=") && ciAnnotationHelper.includes("GITHUB_STEP_SUMMARY") && ciAnnotationHelper.includes("slice(-80)"));
check("CI annotation helper fixture test exists", fs.existsSync(ciAnnotationHelperTestPath));
check("CI annotation helper fixture tests failing command output", ciAnnotationHelperTest.includes("compiler tail line") && ciAnnotationHelperTest.includes("::error title=failing command::"));
check("Release summary script exists", fs.existsSync("scripts/release-summary.mjs"));
check("Release summary reports platform coverage", releaseSummary.includes("Platform coverage") && releaseSummary.includes("Windows EXE") && releaseSummary.includes("Linux DEB"));
check("Release summary handles uppercase installer extensions", releaseSummary.includes("findInstallerArtifacts") && releaseArtifactsLib.includes("path.extname(file).toLowerCase()") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("_aarch64.DMG"));
check("Release summary reports publish readiness", releaseSummary.includes("Publish readiness") && releaseSummary.includes("exactly one installer per platform is present, non-empty, checksummed, and version-matched") && releaseSummary.includes("duplicatePlatforms") && releaseSummary.includes("checksumMismatchPlatforms") && releaseSummary.includes("staleChecksumEntries") && releaseSummary.includes("invalidChecksumLines") && releaseSummary.includes("duplicateChecksumEntries") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("Publish readiness: incomplete") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("macOS DMG has 2 artifacts") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("checksum mismatch") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("stale checksum dmg/stale.dmg") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("Invalid checksum lines") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("Duplicate checksum entries") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("Publish readiness: exactly one installer"));
check("Release summary requires release manifest for publish readiness", releaseSummary.includes("manifestIssue") && releaseSummary.includes("release manifest missing") && releaseSummary.includes("release manifest invalid") && releaseSummary.includes("Release manifest: missing") && releaseSummary.includes("Release manifest: invalid") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("missing-manifest") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("invalid-manifest"));
check("Release summary validates manifest timestamp, artifact shape, and bytes", releaseSummary.includes("validateManifestArtifactTypes") && releaseSummary.includes("validateReleaseManifestArtifact") && releaseSummary.includes("manifest.generatedAt") && releaseSummary.includes("artifact.sizeBytes") && releaseSummary.includes("artifact.sha256") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("missing-generated-at") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("invalid-generated-at") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("stale-manifest-size") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("stale-manifest-hash"));
check("Release summary flags empty installer artifacts", releaseSummary.includes("empty artifact") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("1 empty"));
check("Release summary flags package-version filename mismatches", releaseSummary.includes("version mismatch: expected") && releaseSummary.includes("versionMismatchPlatforms") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("wrong-version") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("1 version mismatch"));
check("Release summary flags unexpected and unmanifested installers", releaseSummary.includes("findUnexpectedInstallerArtifacts") && releaseSummary.includes("Unmanifested installer artifacts") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("unexpected-installer") && fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("unmanifested-installer"));
check("Release summary fixture test exists", fs.existsSync("scripts/test-release-summary.mjs"));
check("Release summary tests missing platform coverage", fs.readFileSync("scripts/test-release-summary.mjs", "utf8").includes("Windows EXE: missing"));

for (const script of expectedScripts) {
  check(`package script '${script}' exists`, Boolean(packageJson.scripts?.[script]));
}
check("verify:release-scripts tests installer verifier", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:installers"));
check("verify:release-scripts tests checksum generation", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:checksums"));
check("verify:release-scripts tests publish artifact verifier", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:publish-artifacts"));
check("verify:release-scripts tests release asset preparation", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:release-assets"));
check("verify:release-scripts tests release manifest verifier", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:release-manifest"));
check("verify:release-scripts tests release artifact helper", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:release-artifacts-lib"));
check("verify:release-scripts tests debug cache cleanup", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:clean-debug-cache"));
check("verify:release-scripts tests bundle temp cleanup", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:clean-bundle-temp"));
check("verify:release-scripts tests disk preflight", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:disk"));
check("verify:release-scripts tests release summary", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:release-summary"));
check("verify:release-scripts tests LAN smoke report verifier", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:lan-smoke-report"));
check("verify:release-scripts tests LAN smoke report preparation helper", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:prepare-lan-smoke-report"));
check("verify:release-scripts tests smoke report release rows helper", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:smoke-rows"));
check("verify:release-scripts tests release candidate summary helper", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:release-candidate-summary"));
check("verify:release-scripts tests release readiness verifier", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:release-readiness"));
check("verify:release-scripts tests GitHub release asset verifier", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:github-release-assets"));
check("verify:release-scripts tests release asset download helper", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:download-release-assets"));
check("verify:release-scripts tests rustfmt checker", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:rustfmt"));
check("verify:release-scripts tests CI annotation helper", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run test:ci-annotation"));
check("verify:release-scripts runs release summary", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run release:summary"));
check("verify:release-scripts runs package doctor", packageJson.scripts?.["verify:release-scripts"]?.includes("npm run doctor"));
check("verify:release runs scripts-only release gate", packageJson.scripts?.["verify:release"]?.includes("npm run verify:release-scripts"));
check("verify:release runs disk preflight first", packageJson.scripts?.["verify:release"]?.startsWith("npm run check:disk"));
check("check:rust uses a single job to reduce disk pressure", packageJson.scripts?.["check:rust"]?.includes("-j 1"));
check("test:rust uses a single job to reduce disk pressure", packageJson.scripts?.["test:rust"]?.includes("cargo test --manifest-path src-tauri/Cargo.toml -j 1"));
check("test:rust serializes tests that share process-global config", packageJson.scripts?.["test:rust"]?.includes("--test-threads=1"));
check("test:rust exposes CI failure context", packageJson.scripts?.["test:rust"]?.includes("--nocapture"));

const checksumPath = path.join(bundleRoot, "SHA256SUMS.txt");
if (fs.existsSync(checksumPath)) {
  check("Local SHA256SUMS.txt is parseable", readChecksumFile(checksumPath).size > 0);
  verifyLocalChecksums(bundleRoot, checksumPath);
} else {
  warn("Local SHA256SUMS.txt is missing; run a native bundle build and checksum generation.");
}

const macDmgFiles = findFiles(path.join(bundleRoot, "dmg"), ".dmg");
if (process.platform === "darwin") {
  check("Local macOS DMG artifact exists", macDmgFiles.length > 0);
} else if (macDmgFiles.length === 0) {
  warn("No local macOS DMG artifact found on this non-macOS machine.");
}

for (const result of checks) {
  const prefix = result.ok ? "ok" : "fail";
  console.log(`${prefix}: ${result.name}`);
}

const failures = checks.filter((result) => !result.ok);
if (failures.length > 0) {
  throw new Error(`${failures.length} package doctor check(s) failed.`);
}

console.log("Package doctor passed.");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function check(name, ok) {
  checks.push({ name, ok });
}

function warn(message) {
  console.warn(`warn: ${message}`);
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function installerVerifierTestIncludes(text) {
  return fs.readFileSync("scripts/test-installer-verifier.mjs", "utf8").includes(text);
}

function installerChecksumTestIncludes(text) {
  return fs.readFileSync("scripts/test-installer-checksums.mjs", "utf8").includes(text);
}

function publishArtifactVerifierTestIncludes(text) {
  return fs.readFileSync("scripts/test-publish-artifacts.mjs", "utf8").includes(text);
}

function releaseAssetPreparerTestIncludes(text) {
  return fs.readFileSync("scripts/test-prepare-release-assets.mjs", "utf8").includes(text);
}

function releaseManifestVerifierTestIncludes(text) {
  return fs.readFileSync("scripts/test-release-manifest-verifier.mjs", "utf8").includes(text);
}

function publishJobIncludesBefore(needle, laterNeedle) {
  const publishJobIndex = workflow.indexOf("  publish:");
  const needleIndex = workflow.indexOf(needle, publishJobIndex);
  const laterIndex = workflow.indexOf(laterNeedle, publishJobIndex);
  return publishJobIndex >= 0 && needleIndex > publishJobIndex && laterIndex > needleIndex;
}

function assembleJobIncludesBefore(needle, laterNeedle) {
  const assembleJobIndex = workflow.indexOf("  assemble:");
  const publishJobIndex = workflow.indexOf("  publish:");
  const needleIndex = workflow.indexOf(needle, assembleJobIndex);
  const laterIndex = workflow.indexOf(laterNeedle, assembleJobIndex);
  return (
    assembleJobIndex >= 0 &&
    publishJobIndex > assembleJobIndex &&
    needleIndex > assembleJobIndex &&
    laterIndex > needleIndex &&
    laterIndex < publishJobIndex
  );
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function findFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name) === extension)
    .map((entry) => path.join(directory, entry.name))
    .sort();
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

function verifyLocalChecksums(root, checksumPath) {
  const checksums = readChecksumFile(checksumPath);
  for (const [relativePath, expectedHash] of checksums) {
    const file = path.join(root, relativePath);
    check(`Checksum target exists: ${relativePath}`, fs.existsSync(file));
    if (!fs.existsSync(file)) continue;

    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    check(`Checksum matches: ${relativePath}`, actualHash === expectedHash);
  }
}
