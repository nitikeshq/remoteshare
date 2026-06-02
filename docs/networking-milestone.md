# Networking Milestone

## v1 Transport Target

The first production-quality transport should be direct LAN over Wi-Fi or Ethernet.

Recommended order:

1. Persistent trusted-device identity.
2. UDP broadcast discovery for the first LAN MVP.
3. Manual IP fallback.
4. Reconnect loop with backoff and wake/network-change handling.
5. Encrypted control channel.
6. Internet relay only after LAN input sharing is stable.

## Discovery

The current scaffold uses IPv4 UDP broadcast on port `44778` so we can prove auto-detection before adding another native dependency.

Each running app broadcasts:

```text
255.255.255.255:44778
```

The beacon loop also makes a best-effort pass over local interface broadcast addresses, such as `192.168.1.255:44778`, and refreshes that target list periodically so Wi-Fi changes have a chance to recover without restarting the app. Clicking `Scan LAN` sends the local announcement immediately to the current broadcast targets with a scan request flag instead of waiting for the next background beacon. Peers answer accepted scan requests directly to the sender's UDP discovery port, so both computers can appear faster without turning every background beacon into a reply loop. A scan request must pass the same self-device, trusted fingerprint, and advertised public-key validation as normal discovery before a direct reply or UI refresh is sent. macOS/Linux read broadcast addresses from `ifconfig`; Windows computes them from `ipconfig` IPv4/subnet-mask blocks.

The app scaffold now stores the local identity and includes a UDP discovery supervisor plus TCP pairing over discovered endpoints.

Published metadata:

- device ID
- display name
- platform
- protocol version
- control port
- device fingerprint
- identity public key

The current fingerprint is derived from a persisted X25519 identity public key. The matching private key is stored locally and is not used for the ephemeral pairing secret; pairing still exchanges fresh ephemeral X25519 keys for each request.

Longer term, mDNS can replace or complement UDP broadcast. Many networks block broadcast and multicast in similar ways, so manual IP must exist from the first networking release.

Manual endpoints accept `host`, `host:port`, IPv4, raw IPv6, and bracketed IPv6. When the port is omitted, the app defaults to TCP control port `44777`, and the manual endpoint field states that localhost, loopback, unspecified, and link-local IPv6 endpoints are rejected. The control listener starts IPv6 plus IPv4 listener support so manual IPv6 endpoints can be reached when the OS and network allow it, while IPv4-mapped IPv6 peers are normalized back to IPv4 endpoints. The diagnostics panel can copy local IPv4 and IPv6 control endpoints, sorted with private IPv4 LAN addresses first and unique-local IPv6 before global IPv6. Link-local IPv6 endpoints are not advertised or accepted for manual/saved endpoints because they need OS-specific interface scope handling. The normalized manual fallback endpoint is saved in local settings only after the target replies with a valid remote pairing acknowledgement and the pending pairing is registered. If saving the remembered endpoint fails, the pending pairing is removed so the app does not keep a half-created request. Saved manual fallback rows remain pairable but are not marked online until discovery or authenticated reconnect proves reachability. Saved manual and trusted last endpoints are normalized on startup, and invalid local-only, unscoped link-local IPv6, or malformed saved endpoints are cleared so old state does not poison reconnect attempts after restart. The first LAN test path is IPv4; IPv6 discovery is not part of the MVP yet.

## Pairing

Pairing must require explicit approval on both machines.

Each computer has a local role: `Main`, `Client`, or `Both`. `Main` and `Both` can send test input and start capture forwarding. `Client` and `Both` can receive trusted input when the global receive toggle and the trusted-device receive toggle are enabled. Discovery, pairing messages, and trusted-device records carry the peer role so trusted rows keep the correct role after manual pairing, reconnect, restart, or offline fallback. Device, pending-pairing, and trusted-device audit rows display the peer role so testers can catch a wrong Main/Client setup before or after trust is created. The first MVP test sets macOS to `Main` and Windows to `Client`.

Expected flow:

1. Host sees nearby client.
2. User clicks Pair.
3. Both machines show the same short code.
4. User confirms on both machines.
5. Each side stores the peer public key as trusted.

Unknown devices must never auto-pair. Auto-reconnect is only for devices that already have a trusted key.

Incoming control must default to off until the user enables it. Incoming control also has a per-device permission.

Current scaffold behavior:

- TCP pairing listener runs on port `44777` with IPv6 plus IPv4 listener support.
- TCP control messages are versioned, length-prefixed JSON frames with a 64 KiB frame limit.
- Control connect/read/write operations use short timeouts so stalled peers do not hang the runtime.
- Malformed, oversized, unsupported-version, or timed-out inbound control frames are surfaced through the UI network-error status.
- Inbound TCP control rejects non-private remote addresses by default before reading a control frame. This guard can be disabled from settings only for intentional routed-network testing.
- Pair requests can start from a discovered peer or a manual `host:port` target.
- Discovered peer pairing uses the peer device ID, while saved/reconnect fallback pairing can send an explicit endpoint without overwriting the remembered manual fallback. Only manual form submissions update the remembered manual fallback.
- Pair acknowledgements for discovered peers and explicit known-device endpoint pairings must match the selected device ID and fingerprint before a comparison code is shown. When a stored peer public key exists, the acknowledgement must match that public key too. Plain manual endpoint pairing learns identity from the acknowledgement because no prior discovery identity exists.
- Manual pairing remembers the normalized endpoint in runtime status and persisted settings only after a valid pairing acknowledgement is received and the pending request is registered.
- Manual pairing rejects local-only endpoints such as `localhost`, `localhost.localdomain`, loopback addresses, unspecified bind addresses, unscoped link-local IPv6 addresses, and port `0` before sending a pairing request or saving a trusted reconnect endpoint.
- Manual pairing rejects self-pairing attempts and explicit pair rejections without saving the attempted endpoint as the remembered fallback.
- Manual fallback targets can be cleared from the UI without restarting the app.
- Pair requests exchange fresh nonces and ephemeral X25519 public keys.
- Pending requests show a six-digit comparison code derived from both device IDs, both nonces, and both ephemeral public keys.
- Pending requests expire after 120 seconds and are pruned from runtime state.
- Pending pairing requests can be cancelled manually from the UI.
- A new pairing request cannot replace a non-expired request after either side has approved it; the user must cancel the active request first.
- Either side can confirm after seeing the matching code.
- Each side sends an approval message after local confirmation.
- Pair acknowledgement write failures are surfaced through the UI network-error status so interrupted pairing attempts are visible on the receiving computer, and the receiver removes that pending request because the sender never received the comparison code.
- Pending pairing rows show local and remote approval state so testers can see which side is still waiting.
- The UI keeps `Confirm` disabled until the typed six-digit code from the other computer matches the locally visible comparison code, and it labels six-digit mismatches before a backend request is sent.
- Remote pairing approvals must match the pending pairing's device ID, comparison code, fingerprint, and advertised identity public key before they can mark the remote side approved.
- A trusted device is stored only after both local approval and remote approval are present.
- Trusted device records store the peer identity public key when the peer advertises one. Discovery, pairing acknowledgements, and pairing approvals reject a provided identity public key when its fingerprint does not match the advertised fingerprint.
- New trusted pairings derive and store a per-device shared control secret from ephemeral X25519 key agreement plus the pairing nonces.
- Pairing approval messages are authenticated with the pending shared control secret before either side can mark the remote approval complete.
- Invalid, expired, or mismatched remote pairing approvals are surfaced through the UI network-error status instead of failing silently.
- Trusted devices can be forgotten; forgetting clears live health, last failure, pending pairing state, input transport history, and active capture state for that device.
- Runtime status returns devices and pending pairings in deterministic order so LAN/manual pairing rows do not jump around between refreshes.
- Trusted input and reconnect health require the trusted device ID, stored fingerprint, stored identity public key when available, and control-message authentication to match. Reconnect pong validation also rejects any non-empty advertised public key whose bytes do not hash back to the advertised fingerprint.
- Device fingerprints are derived from persisted public identity keys instead of private random secrets. Older pre-keypair local state migrates on startup and should be re-paired with peers that still trust the old fingerprint.
- Authenticated trusted control messages use HMAC-SHA256 with a fresh per-message nonce, and incoming trusted ping/input/pair-approval messages are rejected if the same auth tag is replayed within the replay window.
- Trusted devices created before shared control secrets were added must be re-paired before test input or capture forwarding will start; the UI offers a re-pair action when a stale trusted record still has a known endpoint.
- Device status exposes whether input control is ready, so the UI can show stale trusted pairings as needing re-pairing instead of offering input actions that will be rejected. Per-device Receive toggles are disabled for stale trusted records until the device is re-paired and a shared input secret exists.
- Device rows expose the stored peer fingerprint in shortened form and provide a copy button for the full fingerprint so testers can audit trusted identity after pairing.
- The trusted-device audit view shows the local public-key fingerprint plus each trusted peer's role, full fingerprint, endpoint source, last-seen state, receive permission, input-secret readiness, last failure, and the same recovery hint shown in the device row. The local and peer fingerprints can be copied directly from the audit view for smoke-test evidence.
- Trusted reconnect skips legacy trusted records that do not have a shared control secret because they cannot complete authenticated ping/pong health checks.

Security gap to close before broader public testing:

- Encrypt all future control/input messages.
- Move persisted local identity and trusted-device shared secrets from private local JSON into OS keychain or encrypted local storage before broader public testing.
- Consider per-interface allowlists; the MVP listener binds all interfaces but rejects non-private remote addresses by default and still relies on private-network firewall posture.

## Reconnect

The reconnect worker should retry trusted devices when:

- app starts
- OS wakes from sleep
- network changes
- discovery record changes
- TCP/QUIC connection drops

Use bounded exponential backoff with quick retries immediately after wake or network-change events.

Current scaffold behavior:

- Trusted devices are pinged over the TCP control channel every 8 seconds.
- The reconnect loop respects the persisted trusted-reconnect setting.
- Successful authenticated pings update live latency and persist the trusted device's last endpoint plus a bounded newest-first list of recent verified endpoints, improving restart reconnect after DHCP/IP changes.
- Late successful reconnect/input acknowledgements and late reconnect/input failures for a device that has already been forgotten are ignored before live health or failure state is recorded, so async responses cannot leave ghost trusted state behind for a removed device.
- Pong replies must match the trusted device ID, stored fingerprint, stored identity public key when available, and control-message authentication before the device is marked reachable.
- Pong replies must echo the current ping challenge, so an old authenticated pong cannot mark a fake endpoint reachable.
- Incoming authenticated pings also validate the sender fingerprint and update receiver-side health/last endpoint before replying, so both machines can converge on reachability.
- Background trusted reconnect tries ordered endpoint candidates for each trusted device before backing off: fresh matching discovery endpoint, recent authenticated health endpoint, then saved trusted endpoints. Each trusted device keeps a bounded newest-first list of recent verified endpoints, so one stale saved address does not immediately erase other working fallback addresses.
- Runtime status exposes startup network health for the TCP control listener, UDP discovery listener, app start time, and last trusted reconnect attempt so restart/login recovery can be verified from the UI instead of inferred from background tasks. The startup health UI includes the TCP, UDP, and start-at-login detail strings so smoke-test evidence can show why a service is ready or failed.
- Reconnect backoff is tied to the current ordered endpoint candidates. If discovery, authenticated health, or a saved endpoint changes, the next loop retries immediately instead of waiting for the old endpoint's backoff window.
- The reconnect loop also clears per-device retry backoff after a wake-like scheduler delay, so a laptop sleep or suspended app does not keep waiting on the old exponential backoff before trying trusted endpoints again.
- Failed pong replies clear the matching receiver-side health entry and surface a UI network-error diagnostic.
- Failed pings clear matching live health so offline state is visible quickly.
- Failed reconnect attempts use bounded per-device exponential backoff up to 60 seconds.
- Trusted device rows include a manual reconnect check that sends the same authenticated ping/pong and uses the same ordered endpoint candidates as the background reconnect loop, updates endpoint health immediately, and preserves the same specific failure reasons as background reconnect.
- The Auto reconnect status card can run manual reconnect checks for all trusted devices that have a known endpoint and shared control secret, with overlapping bulk checks disabled while a run is in progress.
- Manual and bulk reconnect check controls are disabled while the trusted-reconnect setting is off, and the backend command rejects direct check requests in that state, so UI and runtime behavior match the reconnect worker state.
- Device rows can show trusted peers as reachable even when UDP discovery is unavailable, as long as the last trusted endpoint still works; those reconnect-only paths are labeled as manual IP instead of direct LAN.
- Device rows expose whether the active endpoint came from discovery, authenticated reconnect health, a saved endpoint, or manual fallback, along with the active endpoint address.
- Device rows include last-seen timing from discovery or authenticated reconnect health so wake/restart/network-change behavior is easier to test.
- Device rows retain the last failed trusted endpoint and reason until the next successful authenticated reconnect, so stale IP and firewall failures are visible after background reconnect checks, manual checks, test input sends, and capture forwarding failures.
- Device rows show recovery hints for stale saved endpoints and TCP/firewall failures. Trusted checks, test input sends, endpoint verification failures, and capture forwarding failures append the same `Set IP` / `Verify IP` recovery hint so testers do not have to infer the stale-endpoint path from a timeout. Trusted devices with input control ready can open the endpoint field with `Edit IP` or `Set IP`, replace it with the peer's current copied endpoint, and verify it with an authenticated ping so the trusted endpoint is updated without re-pairing, even when the trusted record has no previously saved endpoint.
- Copyable local endpoints are sorted so private IPv4 LAN addresses appear before link-local or public interface addresses, followed by IPv6 endpoints with unique-local addresses before global addresses. Link-local IPv6 endpoints are omitted from copy buttons because they require interface scopes.
- Discovered announcements for an existing trusted device are ignored unless the advertised fingerprint matches the trusted record, so a stale or spoofed device ID cannot overwrite the trusted LAN endpoint.
- Reconnect attempts are bounded by the control-channel timeout.
- Network errors emitted by the runtime are surfaced in the UI status line for pairing, reconnect, and input-forwarding diagnostics. User-triggered Tauri network command failures are also converted into visible action messages so failed pairing, manual IP verification, reconnect checks, test input, and capture attempts do not fail silently during smoke testing.

## Same Router, Different Bands

2.4 GHz and 5 GHz Wi-Fi bands should work when the router bridges both bands into the same subnet. Limited broadcast plus interface directed broadcasts improve auto-detection on normal bridged Wi-Fi, but discovery or direct connection can still fail when the router uses guest isolation, VLANs, separate subnets, or firewall rules.

Cellular 4G/5G is different from 2.4/5 GHz Wi-Fi. If one computer is on home Wi-Fi and another is on a cellular network or hotspot with carrier NAT, direct LAN discovery will not work. That path belongs to the future internet relay mode, not the LAN MVP.

The UI should expose connection type:

- Direct LAN
- Manual IP
- Relay
- Offline

## Internet Mode

Internet mode is not part of v1. The clean future path is:

- account or pairing-code based rendezvous
- STUN for NAT discovery
- direct peer-to-peer when possible
- TURN/relay fallback when not possible
- visible latency and relay status

## Bluetooth

Bluetooth is deferred. Cross-platform HID behavior and permissions are too inconsistent for the first release.

## Input Transport

Current scaffold behavior:

- Trusted devices can send a typed `key press r` test input event over the control channel, using the same ordered endpoint candidates as trusted reconnect so a stale discovery endpoint does not block a saved endpoint test. The sender waits for an authenticated receiver acknowledgement before reporting the test as successful, so disabled receive permissions or injection failures stay visible instead of looking like a successful send. Successful acknowledged test input delivery also refreshes trusted connection health and the saved endpoint.
- Late outgoing input acknowledgements for a device that has already been forgotten are ignored before sender-side input audit rows are recorded, so async sends cannot leave ghost input evidence for removed trust.
- Receivers log incoming input transport events with accepted/rejected state, event summary, source device, and relative time so smoke-test evidence can connect the `key press r` and capture events to the trusted sender.
- Incoming input is rejected unless the sender is trusted and incoming control is enabled.
- Incoming input is also rejected when the sender fingerprint or control-message authentication does not match the trusted device record.
- Incoming control now requires both the global receive toggle and the trusted device's per-device receive permission.
- The UI includes a receive shortcut that enables the global incoming-control gate and trusted-device receive permission together, while keeping the individual toggles available for stricter per-device control.
- Incoming input failures, including authentication failure and native injection failure, are retained in the input transport history so testers can distinguish network/auth problems from permission or OS injection problems.
- Accepted incoming events are passed to the native injection adapter.
- macOS injection currently supports mouse move, primary/secondary button down/up events, one-axis scroll, and a limited basic keyboard map when Accessibility permission is granted.
- Windows injection is implemented with `SendInput` for mouse move, primary/secondary button down/up events, wheel scroll, letters, digits, common punctuation captured from macOS, modifier keys, arrow/navigation keys, and basic control keys. It still needs validation on a Windows runner and a real Windows desktop.
- Windows absolute mouse coordinates are scaled to the full 0..65535 `SendInput` range, including the right and bottom screen edges.
- macOS permission status now distinguishes Accessibility from Input Monitoring, and the app can request Input Monitoring access.
- macOS capture uses a listen-only event tap when Input Monitoring is granted. Captured mouse movement, primary/secondary button down/up events, scroll, modifier key down/up events from `flagsChanged`, Return/Enter, arrow/navigation keys, and mapped key down/up events are forwarded to the active trusted target over the authenticated control channel.
- Mouse movement forwarding is throttled and limited to one in-flight move send, so slow endpoints drop redundant movement updates instead of building an unbounded forwarding backlog.
- The UI can select one trusted device as the active host capture target, shows the active capture target plus elapsed start time, and can stop capture mode once the native capture engine is ready.
- Capture forwarding uses the same ordered endpoint candidates as trusted reconnect, so a stale discovery endpoint does not immediately stop capture when a saved endpoint still works. Each forwarded capture event waits for an authenticated receiver acknowledgement before it counts as delivered, so disabled receive permissions or injection failures stop capture instead of silently continuing. Successful acknowledged capture delivery also refreshes trusted connection health and the saved endpoint. Capture mode stops automatically only after forwarding to every active target candidate fails, and the failed endpoint/reason is retained in the device diagnostics.
- The UI exposes Accessibility, Input Monitoring, native input, capture-engine, and injection-engine readiness so testers can see why send/capture actions are unavailable on a given OS.
- Linux capture/injection is unavailable in current builds and still needs an X11/Wayland implementation plan. Wider keyboard/layout handling is also still planned.
