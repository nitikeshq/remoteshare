# Release Checklist

Use this checklist before publishing RemoteShare installers.

## Local Gate

Run the lightweight release verifier:

```bash
npm run verify:release
```

This does not rebuild native installers. It checks local free disk space, typechecks the UI, runs a single-job `cargo check`, builds the frontend, tests checksum generation, installer, publish artifact, release artifact helper, release asset preparation, release manifest verification, debug cache cleanup scripts, and bundle temp cleanup scripts, prints the local release summary, and runs the package doctor.

Run Rust unit tests before release when local disk allows it. This is the single-threaded `cargo test` gate used by CI because some runtime tests switch a process-global test config directory:

```bash
npm run test:rust
```

Check the local Rust formatter toolchain before formatting or review cleanup:

```bash
npm run check:rustfmt
```

This is a local toolchain diagnostic. If it fails with a missing `librustc_driver` library or a similar `rustfmt` load error, repair the active Rust toolchain with `rustup component add rustfmt` or `rustup update stable`. Release readiness still depends on compile/test gates, native runner builds, and hardware LAN smoke evidence.

When disk is too low for Rust or frontend verification, run the scripts-only release gate:

```bash
npm run verify:release-scripts
```

This verifies the release automation, fixture tests, local artifact summary, and package doctor without running `cargo check` or rebuilding the frontend.

The disk preflight defaults to 1024 MiB free and supports macOS, Linux, and Windows runners. Override it with `REMOTESHARE_MIN_FREE_MIB` when a stricter or intentionally looser local/CI threshold is needed. A Rust debug dependency rebuild can need significantly more space than a warm local verification run.

If the local verifier is blocked by Rust debug cache pressure, run:

```bash
npm run clean:debug-cache
```

This removes only generated Rust debug cache directories: `src-tauri/target/debug/build`, `src-tauri/target/debug/deps`, and `src-tauri/target/debug/incremental`. It leaves `src-tauri/target/release/bundle` and existing installer artifacts untouched. The next Rust check will rebuild debug dependencies, so use it only when disk preflight is blocking release verification.

Local `npm run build` runs this cleanup automatically before `tauri build`. If a macOS DMG build fails after creating a generated `rw.*.dmg` file, or if you want to clean the bundle directory manually, run:

```bash
npm run clean:bundle-temp
```

This removes only temporary DMG files named `rw.*.dmg` under `src-tauri/target/release/bundle/dmg` and `src-tauri/target/release/bundle/macos`. It preserves final `.dmg`, `.exe`, `.deb`, and checksum artifacts. These stale temporary images can accidentally be included in the next local DMG source folder and cause recursive disk usage or `hdiutil` failures.

The release summary prints per-platform coverage, flags empty installer artifacts, flags duplicate platform artifacts, flags package-version filename mismatches, and prints a publish-readiness line. Local macOS-only runs should say publish readiness is incomplete until exactly one macOS `.dmg`, one Windows `.exe`, and one Linux `.deb` are present, non-empty, checksummed, and version-matched.

## Native Installers

Build each installer on its native operating system:

- macOS `.dmg`: macOS runner or Mac developer machine.
- Windows `.exe`: Windows runner.
- Linux `.deb`: Ubuntu runner.

The GitHub Actions workflow `.github/workflows/release-builds.yml` is the preferred path because it runs the disk preflight, frontend typecheck, `cargo check`, Rust unit tests, script test gates, native builds, checksum verification, and uploads all platform artifacts.

The workflow also runs `npm run clean:debug-cache` and `npm run clean:bundle-temp` after the Rust check/test gate and before the native bundle build so debug artifacts and stale generated DMG temp files do not compete with installer packaging space. The local `npm run build` script also runs `npm run clean:bundle-temp` before invoking Tauri.

For a pre-tag build, run the workflow manually from GitHub Actions. The `Assemble Release Assets` job verifies all three native runner outputs, prepares flat release assets, writes `RELEASE-MANIFEST.json`, prepares a prefilled `lan-smoke-report.md`, writes `release-candidate-summary.md`, verifies the final flat release bundle with `npm run verify:assembled-release-assets -- release-assets`, publishes that summary into the GitHub Actions job summary, prints the installer rows for smoke evidence, and uploads one combined artifact named `remoteshare-release-assets`.

To reproduce the same assembly locally from the three platform artifacts, download them into one local directory named `release-artifacts`. Keep the artifact subdirectories from GitHub intact, then run:

```bash
npm run verify:publish-artifacts -- release-artifacts
npm run prepare:release-assets -- release-artifacts release-assets
npm run verify:release-manifest -- release-assets
npm run prepare:lan-smoke-report -- release-assets release-assets/lan-smoke-report.md
npm run release:candidate-summary -- release-assets
npm run verify:assembled-release-assets -- release-assets
npm run release:smoke-rows -- release-assets
```

This is the operator path for proving that the Windows `.exe` and Linux `.deb` produced by native runners match the macOS `.dmg` before cutting a `v*` tag. Read the GitHub Actions job summary first, then open `release-candidate-summary.md` from the artifact; both list the installer filenames, hashes, and the smoke/readiness commands testers need.

The prefilled smoke report and release candidate summary helpers refuse to overwrite existing output files, so regenerate them into a fresh `release-assets` directory when rebuilding a candidate.

The prepared `RELEASE-MANIFEST.json` records when release assets were generated, and manifest verification rejects a future `generatedAt` timestamp. The completed LAN smoke report `Test date` must be an ISO `YYYY-MM-DD` date on or after that manifest date and cannot be in the future, so smoke evidence from an older candidate or a prefilled future date cannot be reused for newer assets.

When the workflow runs from a `v*` tag, it creates a draft GitHub Release with exactly one non-empty `.dmg`, one non-empty `.exe`, one non-empty `.deb`, a combined `SHA256SUMS.txt`, `RELEASE-MANIFEST.json`, a prefilled `lan-smoke-report.md`, and `release-candidate-summary.md`. The publish job checks out the repo, sets up Node, installs dependencies, then runs `npm run verify:publish-artifacts -- release-artifacts` to verify all three platform artifact types are present exactly once before running `npm run prepare:release-assets -- release-artifacts release-assets`, which flattens installers and generates combined checksums plus a structured manifest. Both checks reject empty installer artifacts, and prepared release asset filenames plus `RELEASE-MANIFEST.json` must match the current package version so native runner outputs from different app versions cannot be mixed. It then runs `npm run verify:release-manifest -- release-assets` to confirm the manifest matches the release assets and checksum file, `npm run prepare:lan-smoke-report -- release-assets release-assets/lan-smoke-report.md` to prefill the Mac and Windows installer names and hashes before upload, `npm run release:candidate-summary -- release-assets release-assets/release-candidate-summary.md` to write the release candidate smoke-test summary, and `npm run verify:assembled-release-assets -- release-assets` to reject missing, extra, nested, or stale generated files before publishing the summary or attaching release assets. It publishes that summary into the GitHub Actions job summary and runs `npm run release:smoke-rows -- release-assets` so the publish logs show the rows testers should copy into the completed LAN evidence report. It requires `contents: write` permission so it can attach release assets. Keep the release as a draft until `npm run verify:release-readiness -- release-assets path/to/completed-lan-smoke-report.md` passes against real Mac-to-Windows smoke evidence.

If a tagged release workflow fails, do not move, delete, or reuse that tag. Leave the failed tag as historical evidence, fix `main`, bump the package version, and cut the next patch tag. If a failed run created a draft release before failing, leave it unpublished or delete the draft only after confirming the replacement patch tag has produced verified draft assets.

Expected output:

- `src-tauri/target/release/bundle/dmg/*.dmg`
- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/deb/*.deb`
- `src-tauri/target/release/bundle/SHA256SUMS.txt`
- `remoteshare-release-assets` artifact from manual workflow runs
- `release-assets/RELEASE-MANIFEST.json` in the publish job
- `release-assets/lan-smoke-report.md` in the publish job
- `release-assets/release-candidate-summary.md` in the publish job

## Artifact Verification

After a native build, generate and verify checksums:

```bash
npm run checksums:installers
npm run verify:installers
npm run release:summary
```

Checksum generation and installer verification reject empty installer artifacts before writing or accepting release checksums. They also require installer filenames to include the current package version before a native runner artifact is accepted. The release summary reports per-platform coverage, manifest validity, generated release evidence freshness for `lan-smoke-report.md` and `release-candidate-summary.md`, and publish readiness.

For prepared publish assets, verify the manifest against the flat installer directory:

```bash
npm run verify:release-manifest -- release-assets
```

The manifest verifier also rejects extra installer files that are not listed in `RELEASE-MANIFEST.json`, so a stale `.dmg`, `.exe`, `.deb`, `.msi`, or similar file cannot sit beside the intended release assets unnoticed.

For single-platform local checks, pass the expected platform:

```bash
npm run verify:installers -- src-tauri/target/release/bundle macos
npm run verify:installers -- src-tauri/target/release/bundle windows
npm run verify:installers -- src-tauri/target/release/bundle linux
```

## First Smoke Test

Before publishing, install the latest macOS and Windows artifacts on two real computers and complete [first-lan-test.md](first-lan-test.md). Record the MVP acceptance evidence table for both auto-discovery and manual fallback runs using [lan-smoke-report-template.md](lan-smoke-report-template.md) before treating a build as release-ready. For setup context, paste the setup checklist `Copy` output from both computers so the report records role, platform, first-MVP input direction, and checklist step state; model/version rows must identify the physical Mac and Windows computers plus OS versions; firewall rows must show allowed/successful rules for TCP `44777` and UDP `44778`; paste the Mac sender setup checklist output into both macOS permission rows so they show `Mac input permissions: done` with Accessibility and Input Monitoring. For pairing, paste the pending pairing row `Copy` output into the pair-action, visible-code, typed-code, and pairing-evidence rows so the report records pairing direction, this computer, visible code, typed-code state, local/remote approval, and expiry. For trust and fingerprints, paste the Trusted Device Audit peer row `Evidence` output into the trusted and fingerprint rows so the report records this computer, local fingerprint, peer, peer role, and peer fingerprint. For startup health, paste the Startup health `Copy` output after restart so the report records `Startup health`, `This computer`, `TCP:`, `UDP:`, `Start:`, and started/reconnect timing fields. For reconnect, paste the trusted row reconnect `Copy` output after restart/wake so the report records `Auto reconnect: enabled`, `Check: reachable`, `Verification: after restart/wake`, measured latency, last-seen timing, endpoint source, endpoint, last failure, and recovery. The required reconnect evidence still includes `Auto reconnect: enabled`, `Check: reachable`, `Verification: after restart/wake`, last-seen timing, endpoint source, endpoint, last failure, and recovery, plus measured latency. For receiver setup, paste the trusted row receive `Copy` output so the report records `Allow incoming control: enabled`, `Device receive: enabled`, and `Input control: ready`. For capture, paste active capture `Copy` output before Stop and stopped capture `Copy` output after Stop so the report records `Capture: active`, `Capture: stopped`, `This computer`, target, started/stopped timing, and `Result: stopped cleanly`. For auto-discovery/reconnect, the copied endpoint source must show `discovery`, `reconnect`, or `saved endpoint`. For manual fallback, paste the peer `This computer` row's local endpoint `Evidence` output so the report records `Local endpoint`, `This computer`, the copied label as `Best LAN IPv4`, `LAN IPv4`, or `LAN IPv6`, endpoint, TCP `44777`, private-network state, and `Manual fallback: preferred LAN IPv4`, `LAN IPv4`, or `LAN IPv6`; `Endpoint used` must match the copied endpoint. If stale endpoint recovery is needed, use the trusted IP update `Copy` button so the report captures this computer, the target device, recovery action, endpoint field, copied endpoint, TCP port, current endpoint/source, last failure, and recovery hint; the copied endpoint must be concrete and match the manual fallback `Endpoint used`. The completed report Notes must show `Blocking issues: none`, identify screenshots or logs captured for pairing, reconnect, input, and capture evidence, and show `Retest required: no`; unresolved blocking issues, incomplete captured-evidence notes, or required retests fail release readiness.

After preparing flat release assets, print the installer rows that should be copied into the smoke report:

```bash
npm run release:smoke-rows -- release-assets
```

Or generate a prefilled smoke report from the template:

```bash
npm run prepare:lan-smoke-report -- release-assets reports/completed-lan-smoke-report.md
```

Tagged GitHub releases attach a prefilled `lan-smoke-report.md`; download it, complete the hardware evidence rows, then verify the completed copy.

To avoid mixing stale local artifacts with the current draft release, download the tagged draft release assets into a new empty directory and verify the GitHub asset list, sizes, digests, manifest, checksums, prefilled `lan-smoke-report.md`, and `release-candidate-summary.md` in one step:

```bash
npm run download:release-assets -- v$(node -p "require('./package.json').version") release-assets
```

The tag and directory both default on a matching checkout, so this is also valid when `release-assets` does not already contain files:

```bash
npm run download:release-assets
```

Verify the completed report before publishing:

```bash
npm run verify:lan-smoke-report -- path/to/completed-lan-smoke-report.md
```

After preparing flat release assets, run the combined release-readiness verifier:

```bash
npm run verify:release-readiness -- release-assets path/to/completed-lan-smoke-report.md
```

This confirms the bundled prefilled `lan-smoke-report.md` still matches the release assets, manifest, and current template; `release-candidate-summary.md` still matches the release assets and manifest; the completed smoke report references the same macOS `.dmg`, Windows `.exe`, and Linux `.deb` basenames and 64-character SHA-256 hashes present in `RELEASE-MANIFEST.json`; setup evidence includes the setup checklist `Copy` output; pairing evidence includes the pending row `Copy` output; fingerprint evidence includes the Trusted Device Audit peer row `Evidence` output; startup health evidence includes the Startup health `Copy` output; receiver setup evidence includes the receive `Copy` output; auto-discovery/reconnect evidence includes the endpoint source shown in the UI and measured latency; manual fallback evidence includes the local endpoint `Evidence` output with label, endpoint, TCP port, private-network state, and manual-fallback eligibility, and `Endpoint used` matches that copied endpoint; trusted-IP recovery evidence uses the trusted IP update `Copy` output when a retry is needed, with a concrete copied endpoint that matches the manual fallback `Endpoint used`; Notes have no unresolved blocking issues, identify captured screenshots or logs for pairing, reconnect, input, and capture evidence, and have no required retests; and that the smoke report version matches the package version being released. For compatibility with older checklists, auto-discovery/reconnect evidence includes the endpoint source shown in the UI.
