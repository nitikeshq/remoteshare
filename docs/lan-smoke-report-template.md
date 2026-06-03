# LAN Smoke Report Template

Copy this template for each macOS-to-Windows MVP smoke test. A release candidate is not ready until both the auto-discovery run and manual fallback run have a pass result. A tracked blocking issue should be recorded in Notes, but it does not satisfy release readiness. The Test date row must use an ISO `YYYY-MM-DD` calendar date and cannot be in the future. Installer file rows must use the platform package extensions `.dmg`, `.exe`, and `.deb`, and installer SHA fields must use the 64-character SHA-256 values from `RELEASE-MANIFEST.json`. The role rows must paste setup checklist `Copy` output from both computers, showing macOS as `Main`, Windows as `Client`, platform, role, input direction, and checklist step states for the first MVP direction. Auto-discovery IP rows must use same-subnet IPv4 CIDR values such as `192.168.1.10/24` and `192.168.1.20/24`. Firewall rows must show allowed/successful status, and macOS Accessibility plus Input Monitoring rows must paste the Mac sender setup checklist `Copy` output showing `Mac input permissions: done` with Accessibility and Input Monitoring. Pairing action and code rows must paste pending-row `Copy` output, including pairing direction, this computer, visible code, typed-code state, local/remote approval, and expiry. Trust rows must paste the Trusted Device Audit evidence output with `This computer`, `Local fingerprint`, `Peer`, and `Peer fingerprint` fields. Reconnect rows must paste the full trusted row reconnect `Copy` output and say it was captured after restart/wake, so `This computer`, trusted device, Auto reconnect enabled, `Check: reachable`, measured `Latency: N ms`, last-seen timing, endpoint, and endpoint source are recorded; the endpoint source must be discovery, reconnect, or saved endpoint for auto-discovery and saved endpoint or manual IP for manual fallback. Startup health rows must paste the Startup health `Copy` output with `Startup health`, `This computer`, `TCP:`, `UDP:`, `Start:`, and started/reconnect timing fields so TCP and UDP are ready and start-at-login is not failed. Manual fallback rows must explain that discovery was disabled, skipped, unavailable, or failed, and the endpoint copy and copied label rows must paste the peer computer's local endpoint `Evidence` output from the `This computer` row, including `Local endpoint`, `This computer`, `Label: Best LAN IPv4` / `LAN IPv4` / `LAN IPv6`, `Endpoint`, `TCP port: 44777`, and private-network state. Receiver permission rows should paste the trusted row receive `Copy` output, including `Allow incoming control: enabled`, `Device receive: enabled`, and `Input control: ready`. Input smoke rows must paste sender and receiver Input Transport row `Copy` output: the sender `Test` row must include `Input Transport: Outgoing`, `This computer`, `Summary: key press r`, `Device`, `Time`, and `Status: Accepted`, and the receiver Input Transport row must include `Input Transport: Incoming`, `This computer`, `Summary: key press r`, `Device`, `Time`, and `Status: Accepted`. Capture rows must paste stopped capture `Copy` output with `Capture: stopped`, `This computer`, `Target`, `Started`, `Stopped`, and `Result: stopped cleanly`; the active capture timing row must paste the capture `Copy` output with `Capture: active`, `This computer`, `Target`, and `Started` before pressing Stop, and the receiver capture event row must paste Input Transport `Copy` output for accepted incoming mouse move, mouse click, scroll, and key events. Failure reason rows must say `none` or `no failure` when no retry was needed; otherwise they must mention the visible UI diagnostic or recovery hint shown before retry. Manual fallback retry evidence must paste the trusted IP update `Copy` output with this computer, device, recovery action, endpoint field, current endpoint/source, last failure, and recovery hint, and it must still mention the manual IP, Set IP / Verify IP, copied endpoint, TCP `44777`, or firewall recovery path. The manual fallback endpoint must match the peer computer's copied control endpoint on TCP `44777`, using a private IPv4 or unique-local IPv6 literal such as `192.168.1.20:44777` or `[fd00::20]:44777`, not a public IP literal or link-local IPv6 address. The TCP reachability row must name a successful TCP `44777` probe, such as Test-NetConnection, nc/netcat, telnet, socket connect, or port probe; a bare `reachable` result is not enough. Notes must identify screenshots or logs captured for the pairing, reconnect, input, and capture evidence.

## Test Context

| Field | Value |
| --- | --- |
| Test date |  |
| Tester |  |
| RemoteShare version/tag |  |
| Input direction | Paste setup checklist `Copy` output from the Mac sender. |
| macOS role shown | Paste setup checklist `Copy` output from the Mac sender. |
| Windows role shown | Paste setup checklist `Copy` output from the Windows receiver. |
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
| macOS Accessibility permission | Paste setup checklist `Copy` output from the Mac sender showing `Mac input permissions: done`. |
| macOS Input Monitoring permission | Paste setup checklist `Copy` output from the Mac sender showing `Mac input permissions: done`. |

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
