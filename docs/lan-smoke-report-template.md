# LAN Smoke Report Template

Copy this template for each macOS-to-Windows MVP smoke test. A release candidate is not ready until both the auto-discovery run and manual fallback run have a pass result. A tracked blocking issue should be recorded in Notes, but it does not satisfy release readiness. The Test date row must use an ISO `YYYY-MM-DD` calendar date and cannot be in the future. Installer file rows must use the platform package extensions `.dmg`, `.exe`, and `.deb`, and installer SHA fields must use the 64-character SHA-256 values from `RELEASE-MANIFEST.json`. The role rows must show macOS as `Main` and Windows as `Client` for the first MVP direction, backed by setup checklist `Copy` output from both computers when possible. Auto-discovery IP rows must use same-subnet IPv4 CIDR values such as `192.168.1.10/24` and `192.168.1.20/24`. Firewall rows must show allowed/successful status, and macOS Accessibility plus Input Monitoring must be enabled. Pairing evidence rows should paste the pending-row copy output, including pairing direction, visible code, typed-code state, local/remote approval, and expiry. Fingerprint rows should use the Trusted Device Audit view to copy or visually compare the local and peer full fingerprints. Reconnect rows must say Auto reconnect stayed enabled after restart/wake, `Check` succeeded after restart/wake, startup health showed TCP ready, UDP ready, and start-at-login not failed, and the endpoint source was shown as discovery, reconnect, or saved endpoint for auto-discovery and saved endpoint or manual IP for manual fallback. Manual fallback rows must explain that discovery was disabled, skipped, unavailable, or failed, must say the endpoint was copied from the peer computer's `This computer` row, and must record the copied button label shown in the UI: `Best LAN IPv4`, `LAN IPv4`, or `LAN IPv6`. Receiver permission rows should paste the trusted row receive `Copy` output, including `Allow incoming control: enabled`, `Device receive: enabled`, and `Input control: ready`. Input smoke rows must say the receiver accepted a `key press r` event and that the Input Transport row showed the source device plus relative time. Capture rows must show capture started and stopped cleanly, the active capture target plus elapsed start time was visible, and accepted mouse move, mouse click, scroll, and key events were visible on the receiver. Failure reason rows must say `none` or `no failure` when no retry was needed; otherwise they must mention the visible UI diagnostic or recovery hint shown before retry. Manual fallback retry evidence must paste the trusted IP update `Copy` output with device, endpoint field, current endpoint/source, last failure, and recovery hint, and it must still mention the manual IP, Set IP / Verify IP, copied endpoint, TCP `44777`, or firewall recovery path. The manual fallback endpoint must be the peer computer's copied control endpoint on TCP `44777`, using a private IPv4 or unique-local IPv6 literal such as `192.168.1.20:44777` or `[fd00::20]:44777`, not a public IP literal or link-local IPv6 address. The TCP reachability row must name a successful TCP `44777` probe, such as Test-NetConnection, nc/netcat, telnet, socket connect, or port probe; a bare `reachable` result is not enough. Notes must identify screenshots or logs captured for the pairing, reconnect, input, and capture evidence.

## Test Context

| Field | Value |
| --- | --- |
| Test date |  |
| Tester |  |
| RemoteShare version/tag |  |
| Input direction | macOS sender/main -> Windows receiver/client |
| macOS role shown | Main |
| Windows role shown | Client |
| macOS model/version |  |
| Windows model/version |  |
| macOS installer file |  |
| macOS installer SHA256 |  |
| Windows installer file |  |
| Windows installer SHA256 |  |
| Linux installer file |  |
| Linux installer SHA256 |  |
| Router/SSID/band |  |
| Same subnet confirmed |  |
| macOS firewall status |  |
| Windows firewall status |  |
| macOS Accessibility permission |  |
| macOS Input Monitoring permission |  |

## Auto-Discovery Run

| Field | Result |
| --- | --- |
| macOS IP/subnet |  |
| Windows IP/subnet |  |
| Peer appeared in `Scan LAN` |  |
| Pair action started |  |
| Same six-digit code shown on both machines |  |
| Six-digit code typed on both machines |  |
| Pairing evidence copied from pending row |  |
| `Trusted` shown on both machines |  |
| Full fingerprint copied or visually compared |  |
| `Auto reconnect` enabled after restart/wake |  |
| Startup health shows TCP ready, UDP ready, and start-at-login not failed |  |
| `Check` succeeded after restart/wake |  |
| Endpoint source shown |  |
| `Allow incoming control` enabled on receiver |  |
| Per-device `Receive` enabled |  |
| Sender `Test` delivered accepted `key press r` input event |  |
| Input Transport source device and relative time shown |  |
| Capture started on sender and stopped cleanly |  |
| Active capture target and elapsed start time shown |  |
| Captured mouse move, mouse click, scroll, and key events accepted on receiver |  |
| Failure reason visible before retry |  |
| Pass/fail |  |

## Manual Fallback Run

| Field | Result |
| --- | --- |
| Discovery disabled, skipped, or failed |  |
| Manual endpoint copied from peer `This computer` row |  |
| Copied endpoint label shown |  |
| Endpoint used |  |
| TCP `44777` reachable |  |
| Pair action started |  |
| Same six-digit code shown on both machines |  |
| Six-digit code typed on both machines |  |
| Pairing evidence copied from pending row |  |
| `Trusted` shown on both machines |  |
| Full fingerprint copied or visually compared |  |
| `Auto reconnect` enabled after restart/wake |  |
| Startup health shows TCP ready, UDP ready, and start-at-login not failed |  |
| `Check` succeeded after restart/wake |  |
| Endpoint source shown as saved endpoint or manual IP |  |
| `Allow incoming control` enabled on receiver |  |
| Per-device `Receive` enabled |  |
| Sender `Test` delivered accepted `key press r` input event |  |
| Input Transport source device and relative time shown |  |
| Capture started on sender and stopped cleanly |  |
| Active capture target and elapsed start time shown |  |
| Captured mouse move, mouse click, scroll, and key events accepted on receiver |  |
| Failure reason visible before retry |  |
| Pass/fail |  |

## Notes

- Blocking issues:
- Screenshots or logs captured:
- Retest required:
