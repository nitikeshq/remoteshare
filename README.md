# RemoteShare

RemoteShare is an early LAN MVP for sharing a Mac keyboard and mouse with a Windows computer. The planned architecture is a Rust desktop daemon with a lightweight Tauri settings UI, with broader cross-platform input capture planned after the first Mac-main to Windows-client path is solid.

## Goals

- Pair computers once and reconnect trusted devices automatically.
- Discover nearby computers on the same LAN without requiring IP addresses.
- Support manual IP pairing when routers block discovery.
- Package for macOS, Windows, and Linux.

## Current Milestone

This repository currently contains the Tauri app shell, settings UI, persisted public-key device identity/settings, IPv4 UDP LAN discovery, remembered manual pairing fallback, two-sided pairing approval with typed code comparison, X25519-derived trusted control secrets, bounded authenticated TCP control framing, private-network inbound guarding, trusted reconnect checks, per-user startup registration, macOS input capture/injection, Windows input injection scaffolding, and packaging/CI setup. The first hardware MVP path is macOS as the sender/main computer and Windows as the receiver/client. Windows input capture, Linux input support, broader keyboard/layout handling, OS keychain storage, per-interface allowlists, and full encrypted transport are still planned.

## Connection Behavior

- Computers on the same reachable subnet can auto-detect each other with UDP broadcast on `44778`.
- Pairing and trusted reconnect use TCP control on `44777` with IPv6 plus IPv4 listener support.
- Incoming TCP control is private-network-only by default. Turn this off only for deliberate routed-network or future internet relay testing.
- Routers, guest Wi-Fi, VLANs, VPNs, and client isolation can block auto-detection even when both computers are on the same router.
- Manual pairing accepts hostnames, `host:port`, IPv4, raw IPv6, bracketed IPv6, and bracketed IPv6 with a port. When no port is provided, RemoteShare uses `44777`. Copyable diagnostics can include IPv4 and IPv6 endpoints, while LAN auto-discovery is still IPv4 broadcast for the MVP.
- The saved manual endpoint is restored after restart and can be cleared from the app.

## Security Status

- The current MVP is for trusted private LANs, not untrusted public networks.
- Pairing uses typed code confirmation and X25519-derived trusted control secrets.
- Trusted control messages are authenticated before reconnect checks or input events are accepted.
- Full encrypted transport is still planned before internet relay or broader public-network use.

## First LAN Test

1. Install and open RemoteShare on both computers.
2. Keep both computers on the same bridged subnet when possible.
3. Allow inbound TCP `44777` and UDP `44778` in the OS firewall.
4. Click `Scan LAN`; if discovery is blocked, copy this computer's endpoint from the diagnostics row and paste it into `Manual pair` on the other computer.
5. Confirm the same six-digit pairing code on both computers.
6. Type the six-digit code shown on the other computer, then click `Confirm` on both computers.
7. Confirm `Auto reconnect` is on. Use `Check` on the trusted device row after restart, wake, or Wi-Fi changes to verify reconnect.

See [docs/first-lan-test.md](docs/first-lan-test.md) for the full Mac-to-Windows LAN test runbook and [docs/lan-smoke-report-template.md](docs/lan-smoke-report-template.md) for the MVP acceptance evidence report.

See [docs/transport-roadmap.md](docs/transport-roadmap.md) for the LAN-first, internet-relay-second, Bluetooth-later transport plan.

## Development

```bash
npm ci
npm run dev
```

Tauri requires Rust and platform build tools.

Run the local verification set without creating native installers:

```bash
npm run doctor
npm run verify
npm run test:rust
```

Run the combined lightweight release gate without creating native installers:

```bash
npm run verify:release
```

The disk preflight defaults to 1024 MiB free because a Rust debug dependency rebuild can consume significantly more than a warm local check. Set `REMOTESHARE_MIN_FREE_MIB` only when you intentionally want a stricter or looser local gate.

If the disk preflight fails because Rust debug cache has filled the local target directory, run:

```bash
npm run clean:debug-cache
```

This removes only Rust debug cache directories such as Cargo build-script output, debug dependencies, and incremental state. Existing release bundle artifacts are left untouched.

## Build

```bash
npm run build
```

Expected local output paths:

- macOS DMG: `src-tauri/target/release/bundle/dmg/`
- Windows installer: `src-tauri/target/release/bundle/nsis/`
- Debian package: `src-tauri/target/release/bundle/deb/`

Windows installers should be built on a Windows runner. macOS DMGs should be built on macOS.

The release workflow typechecks the frontend, runs `cargo check`, runs Rust unit tests, builds macOS, Windows, and Linux bundles on their native GitHub Actions runners, verifies that each platform artifact set contains only the expected non-empty installer type, prints a release summary with per-platform artifact coverage, and uploads installer artifacts with a `SHA256SUMS.txt` file. Manual workflow runs also assemble a single `remoteshare-release-assets` artifact containing the flat `.dmg`, `.exe`, `.deb`, `SHA256SUMS.txt`, `RELEASE-MANIFEST.json`, prefilled `lan-smoke-report.md`, and `release-candidate-summary.md` for smoke testing before a tag is cut. The manual and tagged release jobs also publish `release-candidate-summary.md` into the GitHub Actions job summary so testers can see the installer filenames, hashes, and smoke commands before downloading artifacts. For tagged releases, the publish job prepares the same flat release assets, writes `RELEASE-MANIFEST.json`, verifies the manifest against the installers and combined checksum file, and creates a draft GitHub Release so the hardware LAN smoke/readiness report can be completed before the release is made public. Locally, `npm run verify:release` runs the same lightweight checks that do not require a native package rebuild and prints the local release summary when artifacts already exist.

For a pre-tag build, run the release workflow manually, read the release candidate details in the GitHub Actions job summary, download `remoteshare-release-assets`, and open `release-candidate-summary.md`. To reproduce the same assembly locally from the three platform artifacts, keep the GitHub artifact subdirectories under `release-artifacts`, then run:

```bash
npm run verify:publish-artifacts -- release-artifacts
npm run prepare:release-assets -- release-artifacts release-assets
npm run verify:release-manifest -- release-assets
npm run prepare:lan-smoke-report -- release-assets release-assets/lan-smoke-report.md
npm run release:candidate-summary -- release-assets
npm run release:smoke-rows -- release-assets
```

See [docs/release-checklist.md](docs/release-checklist.md) for the publish checklist and expected `.dmg`, `.exe`, `.deb`, and checksum artifacts.
The final release-readiness check combines prepared release assets with the completed LAN smoke report, and also verifies the bundled prefilled `lan-smoke-report.md` and `release-candidate-summary.md` still match the release assets:

```bash
npm run prepare:lan-smoke-report -- release-assets reports/completed-lan-smoke-report.md
npm run release:smoke-rows -- release-assets
npm run verify:release-readiness -- release-assets path/to/completed-lan-smoke-report.md
```

Generate installer checksums locally after a native bundle build:

```bash
npm run checksums:installers
npm run verify:installers -- src-tauri/target/release/bundle macos
npm run release:summary
```

On this Mac, a simple local DMG can be created from the built `.app` with:

```bash
hdiutil create -volname RemoteShare -srcfolder src-tauri/target/release/bundle/macos/RemoteShare.app -ov -format UDZO src-tauri/target/release/bundle/dmg/RemoteShare_0.1.0_aarch64.dmg
```
