# First LAN Test Runbook

Use this runbook for the first macOS-to-Windows RemoteShare MVP test. In this milestone, macOS is the sender/main computer for input capture and Windows is the receiver/client for input injection.

## Prerequisites

- RemoteShare is installed and open on both computers.
- Both computers are on the same bridged subnet when possible.
- Inbound TCP `44777` and UDP `44778` are allowed in each OS firewall.
- `Private network only` is enabled unless you are intentionally testing a routed private subnet.
- macOS has Accessibility permission for injection and Input Monitoring permission for capture when testing input forwarding.
- Windows receives injected input for this smoke test; Windows-side capture is planned for a later milestone.
- Windows should show the RemoteShare process as allowed on the active network profile.

## Firewall Setup

RemoteShare uses TCP `44777` for pairing/control and UDP `44778` for LAN discovery. Configure both computers before testing.

### Windows

1. Open Windows Security > Firewall & network protection > Allow an app through firewall.
2. Allow RemoteShare on the active network profile. Prefer a Private network for the first LAN test.
3. If the app rule is missing, run PowerShell as Administrator and add explicit Private-profile port rules:

```powershell
New-NetFirewallRule -DisplayName "RemoteShare TCP 44777" -Direction Inbound -Protocol TCP -LocalPort 44777 -Profile Private -Action Allow
New-NetFirewallRule -DisplayName "RemoteShare UDP 44778" -Direction Inbound -Protocol UDP -LocalPort 44778 -Profile Private -Action Allow
```

### macOS

1. Open System Settings > Network > Firewall.
2. Open Options and allow incoming connections for RemoteShare.
3. Open System Settings > Privacy & Security.
4. Grant Accessibility for receiving injected input and Input Monitoring for capturing local keyboard/mouse events.

## Pairing

1. Open RemoteShare on both computers.
2. Set the macOS sender role to `Main` and the Windows receiver role to `Client`. `Both` is acceptable for later bidirectional tests, but not needed for the first smoke run. The setup checklist is role-aware: on macOS it expects the sender role, Mac input permissions, the Windows client as peer, and Windows receive setup; on Windows it expects the receiver role, Windows injection readiness, the Mac sender as peer, and local receive permission.
3. Click `Scan LAN` on either computer.
4. If the other computer appears, click `Pair`.
5. If discovery does not find the other computer, copy a `This computer` endpoint from the diagnostics row on one machine and paste it into `Manual pair` on the other. Record whether discovery was skipped, blocked, unavailable, or failed, and record that the endpoint was copied from the peer computer. Before pairing manually, record a successful TCP `44777` probe such as `Test-NetConnection`, `nc`/netcat, telnet, socket connect, or port probe.
6. If multiple endpoints are shown, prefer the `Best LAN IPv4` endpoint on the same Wi-Fi/LAN subnet as the other computer. Unique-local `LAN IPv6` or routable IPv6 fallback endpoints can be used for manual fallback when both computers and the network support IPv6. Avoid VPN, loopback, hotspot, link-local IPv6, or cellular addresses for the first LAN test.
7. Confirm that both computers show the same six-digit code.
8. Type the six-digit code shown on the other computer, then click `Confirm` on both computers.
9. Verify that the device row shows `Trusted` and a shortened key fingerprint.
10. Open `Trusted Device Audit` and use its `Key` buttons to copy or compare the full local and peer fingerprints for evidence.

## Reconnect

1. Restart one app or wake one computer from sleep.
2. Confirm `Auto reconnect` is on. Use `Check` on the trusted device row.
3. A successful reconnect should update last-seen timing and show the endpoint source as discovery, reconnect, or saved endpoint. Record that exact source text; vague values like `shown` are not enough for release evidence. Verified endpoints are kept as newest-first trusted fallback candidates for future restarts or IP changes.
4. Confirm the diagnostics panel shows startup health with TCP and UDP ready after the app restarts, and that start-at-login health is not failed.
5. If reconnect fails, use `Edit IP`, replace the field with the copied endpoint from the other computer, then use `Verify IP` to update the trusted endpoint without pairing again.

## Input Smoke Test

1. Confirm the receiver role is `Client` or `Both`, then use `Enable all`, `Enable global`, or `Enable devices` in the input-control summary on the receiving computer, or enable `Allow incoming control` globally and `Receive` on the trusted device row for the sender.
2. Confirm the receiving trusted row shows `Receive` enabled.
3. Use `Test` on the sender.
4. The receiver should show an accepted input transport event.
5. Verify macOS Input Monitoring and Accessibility are granted, then use `Capture` on the sender.
6. Move the mouse, click, scroll, and press a basic key. The receiver should show accepted mouse move, mouse click, scroll, and key events.
7. Use `Stop` on the sender and confirm capture stops cleanly.

## MVP Acceptance Evidence

Record one test row for auto-discovery and one test row for manual fallback. Use [lan-smoke-report-template.md](lan-smoke-report-template.md) for release-candidate runs, then verify the completed report with `npm run verify:lan-smoke-report -- path/to/completed-lan-smoke-report.md`. The first public MVP is not accepted until macOS-to-Windows pairing, trusted reconnect after restart, input smoke, and captured mouse/key/scroll forwarding all pass on real hardware.

| Field | Auto-discovery run | Manual fallback run |
| --- | --- | --- |
| macOS installer/version |  |  |
| Windows installer/version |  |  |
| macOS IP/subnet |  |  |
| Windows IP/subnet |  |  |
| Router/SSID/band |  |  |
| macOS role shown | Main | Main |
| Windows role shown | Client | Client |
| Discovery result | Peer appeared in `Scan LAN` | Discovery intentionally skipped or failed |
| Manual endpoint used | None | Discovery skipped/failed, endpoint copied from `This computer` on peer, copied label recorded as `Best LAN IPv4`, `LAN IPv4`, or `LAN IPv6`, and successful TCP `44777` probe recorded |
| Pairing result | Same six-digit code typed and confirmed on both machines | Same six-digit code typed and confirmed on both machines |
| Trusted fingerprint check | Full fingerprint copied or visually compared | Full fingerprint copied or visually compared |
| Reconnect result | `Check` succeeds after app restart or wake | `Check` succeeds after app restart or wake |
| Startup health | TCP ready, UDP ready, and start-at-login not failed after restart | TCP ready, UDP ready, and start-at-login not failed after restart |
| Endpoint source shown | Discovery or reconnect | Saved endpoint or manual IP |
| Input test result | Receiver logs accepted input transport event | Receiver logs accepted input transport event |
| Capture result | Capture starts/stops cleanly and accepted mouse move, click, scroll, and key events are visible | Capture starts/stops cleanly and accepted mouse move, click, scroll, and key events are visible |
| Failure reason before retry | `none` or visible UI diagnostic/recovery hint | `none` or manual IP / Set IP / Verify IP / copied endpoint / TCP `44777` / firewall recovery hint |

Minimum pass criteria:

- Both machines show the same typed pairing code before trust is stored.
- `Trusted` appears on both machines with the expected peer fingerprint.
- `Auto reconnect` remains enabled after restart.
- `Check` succeeds after at least one app restart, wake, or Wi-Fi reconnect.
- `Test` sends an accepted `key press r` input transport event to the receiver.
- Capture starts on the macOS sender, forwards accepted mouse move, mouse click, scroll, and key events to the Windows receiver, then stops cleanly.
- Manual fallback succeeds when UDP discovery is unavailable and a successful TCP `44777` probe is recorded, such as `Test-NetConnection`, `nc`/netcat, telnet, socket connect, or port probe.
- Any failed endpoint, firewall, permission, or stale-IP reason is visible in the UI before retrying. Manual fallback retry evidence must mention the manual IP, Set IP / Verify IP, copied endpoint, TCP `44777`, or firewall recovery path.

## Troubleshooting

- No LAN discovery: confirm both devices are on the same subnet and UDP `44778` is not blocked.
- Manual pair fails: confirm a TCP `44777` probe succeeds and the endpoint is copied from the other computer, not the same computer.
- Manual pair rejects `localhost`, localhost aliases such as `localhost.localdomain`, loopback addresses such as `127.0.0.1` or `::1`, unspecified bind addresses such as `0.0.0.0`, and public literal IPs while `Private network only` is enabled; copy an endpoint from the other computer instead.
- On Windows, confirm the active network profile is Private, then run `Test-NetConnection <other-computer-ip> -Port 44777` in PowerShell.
- If ping is allowed on the network, confirm both computers can ping each other before testing manual pairing.
- Same router but different SSID or band: this works only when the router bridges both networks into the same subnet.
- Guest Wi-Fi, VLANs, client isolation, VPNs, and firewall rules can block both discovery and direct TCP.
- Manual pair from a routed subnet fails: keep `Private network only` on for normal LAN tests, but turn it off only if the peer address is intentionally routed and trusted.
- Stale or missing saved endpoint: copy the current endpoint from the other computer, use `Edit IP` or `Set IP`, then `Verify IP` to update the trusted endpoint without pairing again. Failed trusted checks, test input, and capture forwarding should point to this recovery path. This recovery action should be available for trusted devices with input control ready, even before a failure is recorded.
- Stale trusted record without an input secret or endpoint: use `Pair manually`, paste the current endpoint copied from the other computer, then confirm the new six-digit code on both machines. This creates a fresh shared control secret; `Set IP` / `Verify IP` is only for trusted devices that already show input control ready.
