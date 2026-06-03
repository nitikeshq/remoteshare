# Transport Roadmap

RemoteShare should ship transports in this order.

## Phase 1: Direct LAN

Direct LAN is the MVP path.

- UDP broadcast discovery on `44778`.
- TCP pairing and control on `44777`.
- Manual endpoint fallback for blocked discovery.
- Trusted reconnect using saved endpoints and authenticated ping/pong.
- Clear diagnostics for discovery, manual, saved, and reconnect paths.
- Trusted IP update evidence copies the pasted endpoint, TCP `44777` port, current endpoint/source, last failure, and recovery hint for manual fallback retries.

This is the fastest path for macOS-to-Windows testing because it avoids accounts, NAT traversal, and relay latency.

## Phase 2: Internet Relay

Internet mode should start only after LAN input sharing is stable.

Required pieces:

- Accountless pairing-code rendezvous or an authenticated account flow.
- STUN for NAT detection.
- Direct peer-to-peer connection when possible.
- TURN or custom relay fallback when direct peer-to-peer fails.
- Visible latency and relay status in the UI.
- End-to-end encryption before relaying input events through any server.

The relay server should never be trusted with raw unencrypted keyboard or mouse input.

## Phase 3: Bluetooth

Bluetooth is deferred.

Reasons:

- Cross-platform Bluetooth HID behavior differs heavily across macOS, Windows, and Linux.
- Permissions and pairing behavior are less predictable than LAN.
- Bluetooth range and latency are less suitable for the first multi-computer desk setup.

Bluetooth can be revisited after the LAN and internet transports have stable pairing, reconnect, permissions, and input forwarding.

## Non-Negotiables

- Unknown devices never auto-pair.
- Trusted devices reconnect only after explicit pairing.
- Incoming control stays off globally until the user enables it.
- Per-device receive permission remains separate from the global receive toggle.
- Internet relay traffic must be encrypted end to end.
