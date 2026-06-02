# RemoteShare

RemoteShare is an early open-source desktop app for sharing one keyboard and mouse across computers on a private network.

The first MVP target is:

- main computer: macOS
- client computer: Windows
- transport: local LAN over Wi-Fi/Ethernet
- UI/runtime: Tauri + Rust

Electron was avoided to keep the app lighter. Rust gives us better control over networking, startup behavior, packaging, and native input handling.

## Status

RemoteShare is not production-ready yet. It is a LAN MVP in progress.

Working foundations:

- Tauri desktop app shell
- trusted device identity
- LAN discovery
- manual endpoint pairing fallback
- typed pairing-code confirmation
- authenticated trusted TCP control messages
- auto-reconnect checks
- macOS input capture/injection foundation
- Windows input injection foundation
- GitHub Actions packaging for `.dmg`, `.exe`, and `.deb`

Still planned:

- full hardware smoke test on real Mac-to-Windows machines
- broader keyboard/layout support
- Windows input capture
- Linux input support
- OS keychain storage
- encrypted internet relay
- Bluetooth transport research

## Network

RemoteShare uses these local ports:

- TCP `44777` for trusted control
- UDP `44778` for LAN discovery

Auto-discovery works only when the computers can reach each other on the LAN. Guest Wi-Fi, VLANs, VPNs, router client isolation, and some 2.4 GHz/5 GHz network splits can block discovery.

If discovery fails, use manual pairing and copy the endpoint shown by the other computer.

## Quick Start

```bash
npm ci
npm run dev
```

Requirements:

- Node.js 24
- Rust stable
- platform build tools for Tauri

## Useful Commands

```bash
npm run typecheck
npm run doctor
npm run test:rust
npm run verify:release
```

If Rust build cache fills the disk:

```bash
npm run clean:debug-cache
```

## Build

```bash
npm run build
```

Native installer output:

- macOS: `src-tauri/target/release/bundle/dmg/`
- Windows: `src-tauri/target/release/bundle/nsis/`
- Linux: `src-tauri/target/release/bundle/deb/`

Build each installer on its native OS. GitHub Actions is configured to build macOS, Windows, and Linux artifacts on native runners.

## Releases

Tagged releases create a draft GitHub Release. Keep a release as draft until the LAN smoke test passes on real machines.

The release workflow verifies the installers, writes checksums, creates `RELEASE-MANIFEST.json`, and uploads:

- `.dmg`
- `.exe`
- `.deb`
- `SHA256SUMS.txt`
- `RELEASE-MANIFEST.json`
- `lan-smoke-report.md`
- `release-candidate-summary.md`

## Docs

- [First LAN test](docs/first-lan-test.md)
- [LAN smoke report template](docs/lan-smoke-report-template.md)
- [Release checklist](docs/release-checklist.md)
- [Transport roadmap](docs/transport-roadmap.md)
- [Architecture notes](docs/architecture.md)
