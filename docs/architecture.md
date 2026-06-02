# RemoteShare Architecture

## Product Shape

RemoteShare runs on every computer. One machine can act as the host that captures local mouse and keyboard events. Trusted client machines receive those events and inject them locally.

## Components

- `remoteshare-ui`: Tauri settings app for pairing, device layout, permissions, and diagnostics.
- `remoteshare-daemon`: Rust runtime responsible for discovery, pairing, reconnect, input capture, input injection, and transport.
- `trusted-device-store`: local persisted public/private identity keys, settings, trusted peers, and shared control secrets. OS keychain encryption is still a hardening step.
- `transport`: direct LAN first, manual IP fallback, relay/WebRTC later.

## Connection Strategy

1. Discover LAN devices with UDP broadcast for the first scaffold, then consider mDNS once the LAN MVP is stable.
2. Pair with a short verification code bound to both devices, both nonces, and the ephemeral X25519 key exchange.
3. Store each trusted device by identity public key, fingerprint, and shared control secret, not IP address.
4. Reconnect trusted devices after restart, wake, and network changes.
5. Fall back to a remembered manual IP endpoint when multicast discovery is blocked.
6. Use an internet relay only when direct connectivity fails.

## Wire Protocol

- Discovery uses UDP broadcast on port `44778`.
- Control uses TCP on port `44777`, with IPv6 plus IPv4 listener support.
- Control payloads are versioned JSON envelopes framed with a four-byte big-endian length prefix.
- Control frames are capped at 64 KiB and all connect/read/write operations use bounded timeouts.
- Each device has a persisted X25519 identity keypair. Discovery and pairing expose the identity public key plus its fingerprint, while pairing exchanges separate ephemeral X25519 public keys and derives a shared control secret after the user compares the six-digit code.
- Trusted ping, pong, pairing approval, and input messages are wrapped in an AEAD-encrypted envelope after pairing derives a pending or trusted control secret; pong responses must echo the current ping challenge. Initial pair request/ack frames remain plaintext because no shared secret exists yet.
- Inbound control accepts private/local remote addresses by default and rejects public remote addresses before reading a control frame.

## Startup Registration

- macOS writes a per-user LaunchAgent at `~/Library/LaunchAgents/com.remoteshare.desktop.plist`.
- Windows writes the per-user `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` entry with a quoted executable path so installs under user folders with spaces still launch at login.
- Linux writes a per-user autostart desktop entry under the XDG config autostart directory.
- Startup registration is controlled by the saved `Start at login` setting, and runtime status records whether registration is pending, ready, skipped in development, disabled, or failed.
- Release builds sync the saved startup setting on launch, including removing stale OS autostart entries when the saved setting is off.
- Disabling startup is treated as idempotent where the platform allows it, so an already-missing startup entry does not block saving the off state.
- Startup registration failures are surfaced through the app diagnostics instead of being silently ignored.
- Debug builds avoid automatic registration unless the user changes the setting explicitly.

## State Migration

- Persisted identities, settings, trusted devices, and manual endpoints are stored under the per-user RemoteShare config directory.
- On Unix-like systems, the config directory is written with `0700` permissions and `state.json` is written with `0600` permissions. OS keychain storage is still planned before broader public testing.
- Missing fields from early scaffold builds default safely during load, so upgrades preserve the local device identity and trusted-device list instead of replacing state.
- If the persisted state file cannot be parsed or read, the failed state is copied to a timestamped backup before a fresh identity is created, so trusted-device recovery remains possible during testing.

## Network Engineering Notes

- Same router and same subnet should use direct LAN.
- Same router but different subnet may need manual IP or router rules.
- Auto-detection is limited to reachable broadcast domains. A computer on another SSID, VLAN, guest network, VPN route, or isolated Wi-Fi segment may be on the same physical router but still invisible to UDP discovery.
- Manual endpoints are the supported MVP fallback for blocked discovery. They accept hostnames, host:port, IPv4, raw IPv6, bracketed IPv6, and bracketed IPv6 with a port; missing ports default to TCP `44777`.
- The app surfaces connection-path diagnostics from runtime state: discovered LAN peers, saved manual endpoint, newest-first saved trusted endpoint candidates, and recent trusted reconnect failures.
- Manual IP fallback is saved locally and restored after restart until the user clears it.
- Guest Wi-Fi, client isolation, VPNs, and VLANs can block discovery.
- Internet mode needs authentication, NAT traversal, and relay fallback.
- Bluetooth should wait until LAN behavior is excellent.

## Security Rules

- Never allow blind auto-pairing for unknown computers.
- Pair once, then auto-reconnect only trusted device keys.
- Require typed six-digit code comparison before completing trust.
- Authenticate pairing approval before storing a trusted device.
- Keep private-network-only inbound control enabled for the LAN MVP unless the user intentionally tests a routed private subnet.
- Show connection type and latency in the UI.
- Require explicit user control over incoming control permissions. The default must be off until a user enables it for trusted devices.

## MVP Scope

1. macOS host to Windows client over LAN.
2. Mouse movement, clicks, scroll, and basic keyboard events.
3. UDP LAN discovery and manual IP fallback, with mDNS as a later discovery improvement.
4. Trusted-device auto-reconnect.
5. macOS DMG, Windows NSIS, and Linux DEB installer builds.
