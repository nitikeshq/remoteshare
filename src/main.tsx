import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  CircleDot,
  Copy,
  Keyboard,
  Link,
  Monitor,
  MousePointer2,
  Network,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Wifi
} from "lucide-react";
import "./styles.css";

type ComputerRole = "main" | "client" | "both";

type Device = {
  id: string;
  name: string;
  platform: string;
  role: ComputerRole;
  trusted: boolean;
  online: boolean;
  connection: "direct-lan" | "manual" | "relay" | "offline";
  latencyMs: number | null;
  lastSeenAtMs: number | null;
  endpoint: string | null;
  endpointSource: "discovery" | "health" | "saved" | "manual" | "none";
  publicKeyFingerprint: string | null;
  allowIncomingControl: boolean;
  inputControlReady: boolean;
  lastConnectionFailure: ConnectionFailure | null;
};

type ConnectionFailure = {
  endpoint: string;
  failedAtMs: number;
  message: string;
};

type PendingPairing = {
  id: string;
  deviceId: string;
  name: string;
  platform: string;
  role: ComputerRole;
  endpoint: string;
  code: string;
  direction: "incoming" | "outgoing";
  localApproved: boolean;
  remoteApproved: boolean;
  createdAtMs: number;
  expiresAtMs: number;
};

type InputEventRecord = {
  direction: "incoming" | "outgoing";
  deviceId: string;
  summary: string;
  accepted: boolean;
  atMs: number;
};

type DiscoveryStatus = {
  serviceType: string;
  port: number;
  discoveryPort: number;
  lastScanAtMs: number | null;
  manualEndpoint: string | null;
};

type ServiceHealthState = "starting" | "ready" | "failed";

type ServiceHealthStatus = {
  state: ServiceHealthState;
  detail: string;
  updatedAtMs: number | null;
};

type NetworkHealthStatus = {
  startedAtMs: number;
  startupRegistration: ServiceHealthStatus;
  controlListener: ServiceHealthStatus;
  discovery: ServiceHealthStatus;
  lastReconnectAttemptAtMs: number | null;
};

type RuntimeStatus = {
  thisDevice: string;
  thisDeviceId: string;
  thisPublicKeyFingerprint: string;
  platform: string;
  mode: ComputerRole;
  autoStart: boolean;
  trustedReconnect: boolean;
  privateNetworkOnly: boolean;
  allowIncomingControl: boolean;
  networkHealth: NetworkHealthStatus;
  capture: CaptureStatus;
  discovery: DiscoveryStatus;
  devices: Device[];
  pendingPairings: PendingPairing[];
  recentInputEvents: InputEventRecord[];
};

type CaptureStatus = {
  active: boolean;
  targetDeviceId: string | null;
  startedAtMs: number | null;
};

type NetworkAction = {
  ok: boolean;
  message: string;
};

type PairRequestPayload = {
  deviceId?: string;
  endpoint?: string;
  manualEndpoint?: boolean;
};

type PermissionState = "granted" | "missing" | "unsupported" | "unknown";
type EngineState = "ready" | "planned" | "unsupported";

type InputPermissionStatus = {
  accessibility: PermissionState;
  inputMonitoring: PermissionState;
  inputInjection: PermissionState;
  captureEngine: EngineState;
  injectionEngine: EngineState;
};

const fallbackPermissions: InputPermissionStatus = {
  accessibility: "unknown",
  inputMonitoring: "unknown",
  inputInjection: "unknown",
  captureEngine: "planned",
  injectionEngine: "planned"
};

const fallbackStatus: RuntimeStatus = {
  thisDevice: "This computer",
  thisDeviceId: "local",
  thisPublicKeyFingerprint: "fingerprint unavailable",
  platform: "unknown",
  mode: "main",
  autoStart: true,
  trustedReconnect: true,
  privateNetworkOnly: true,
  allowIncomingControl: false,
  networkHealth: {
    startedAtMs: Date.now(),
    startupRegistration: {
      state: "starting",
      detail: "Start-at-login registration pending.",
      updatedAtMs: null
    },
    controlListener: {
      state: "starting",
      detail: "TCP control listener starting.",
      updatedAtMs: null
    },
    discovery: {
      state: "starting",
      detail: "UDP discovery starting.",
      updatedAtMs: null
    },
    lastReconnectAttemptAtMs: null
  },
  capture: {
    active: false,
    targetDeviceId: null,
    startedAtMs: null
  },
  discovery: {
    serviceType: "udp-broadcast",
    port: 44777,
    discoveryPort: 44778,
    lastScanAtMs: null,
    manualEndpoint: null
  },
  devices: [],
  pendingPairings: [],
  recentInputEvents: []
};

function connectionLabel(device: Device) {
  if (device.connection === "manual" && !device.online) return "Manual target";
  if (!device.online) return "Offline";
  if (device.connection === "direct-lan") return `Direct LAN ${device.latencyMs ?? "-"} ms`;
  if (device.connection === "relay") return `Relay ${device.latencyMs ?? "-"} ms`;
  return `Manual IP ${device.latencyMs ?? "-"} ms`;
}

function shortFingerprint(fingerprint: string | null) {
  if (!fingerprint) return "fingerprint unavailable";
  return fingerprint.length > 16
    ? `${fingerprint.slice(0, 8)}...${fingerprint.slice(-8)}`
    : fingerprint;
}

function lastSeenLabel(atMs: number | null) {
  if (!atMs) return "not seen yet";
  return `seen ${elapsedLabel(atMs)}`;
}

function elapsedLabel(atMs: number) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - atMs) / 1000));
  if (elapsedSeconds < 2) return "now";
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}

function endpointSourceLabel(device: Device) {
  if (!device.endpoint) return "no endpoint";
  if (device.endpointSource === "discovery") return "discovery";
  if (device.endpointSource === "health") return "reconnect";
  if (device.endpointSource === "saved") return "saved endpoint";
  if (device.endpointSource === "manual") return "manual";
  return "endpoint unknown";
}

function endpointDiagnostic(device: Device) {
  return device.endpoint ? `${endpointSourceLabel(device)} · ${device.endpoint}` : "no endpoint";
}

function connectionFailureDiagnostic(device: Device) {
  if (!device.lastConnectionFailure) return null;
  const failure = device.lastConnectionFailure;
  return `last failed ${elapsedLabel(failure.failedAtMs)} · ${failure.endpoint} · ${failure.message}`;
}

function connectionFailureHint(device: Device) {
  if (!device.lastConnectionFailure) return null;
  if (device.endpointSource === "saved") {
    return "Saved endpoint may be stale. Copy the current endpoint from the other computer, then use Edit IP and Verify IP.";
  }
  if (device.endpointSource === "discovery") {
    return "Discovery found the device, but TCP control failed. Check firewall rules for port 44777.";
  }
  if (device.trusted && device.inputControlReady) {
    return "Copy the current endpoint from the other computer, then use Set IP and Verify IP.";
  }
  return "Confirm both apps are open on the same reachable network, then retry or pair manually.";
}

function canEditTrustedEndpoint(device: Device) {
  return device.trusted && device.inputControlReady;
}

function pairRequestForDevice(device: Device): PairRequestPayload {
  const shouldUseEndpoint =
    device.connection === "manual" ||
    device.endpointSource === "manual" ||
    device.endpointSource === "saved" ||
    device.endpointSource === "health";

  return {
    deviceId: device.id,
    ...(shouldUseEndpoint && device.endpoint ? { endpoint: device.endpoint } : {})
  };
}

function pairingExpiryLabel(pairing: PendingPairing) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((pairing.expiresAtMs - Date.now()) / 1000)
  );
  return `${remainingSeconds}s left`;
}

function inputEventStatusLabel(event: InputEventRecord) {
  if (event.accepted) return "accepted";
  return event.direction === "incoming" ? "failed" : "rejected";
}

function inputEventDeviceLabel(event: InputEventRecord, devices: Device[]) {
  return devices.find((device) => device.id === event.deviceId)?.name ?? event.deviceId;
}

function approvalLabel(approved: boolean) {
  return approved ? "approved" : "pending";
}

function roleLabel(role: ComputerRole) {
  if (role === "main") return "Main";
  if (role === "client") return "Client";
  return "Both";
}

function canSendInput(role: ComputerRole) {
  return role === "main" || role === "both";
}

function canReceiveInput(role: ComputerRole) {
  return role === "client" || role === "both";
}

function normalizedPlatform(platform: string) {
  return platform.toLowerCase();
}

function isMacPlatform(platform: string) {
  const value = normalizedPlatform(platform);
  return value.includes("macos") || value.includes("darwin");
}

function isWindowsPlatform(platform: string) {
  return normalizedPlatform(platform).includes("windows");
}

function mvpRoleStep(platform: string, role: ComputerRole) {
  if (isWindowsPlatform(platform)) {
    return {
      done: role === "client" || role === "both",
      detail: "Set this Windows computer to Client and set the Mac sender to Main."
    };
  }

  if (isMacPlatform(platform)) {
    return {
      done: role === "main" || role === "both",
      detail: "Set this Mac to Main and set the Windows computer to Client."
    };
  }

  return {
    done: role === "both",
    detail: "Use Main on the sender, Client on the receiver, or Both for bidirectional testing."
  };
}

function mvpInputPermissionStep(platform: string, permissions: InputPermissionStatus) {
  if (isWindowsPlatform(platform)) {
    return {
      label: "Windows receive ready",
      done: permissions.injectionEngine === "ready",
      detail: "Use Windows as the receiver; local Windows capture is planned for later."
    };
  }

  if (isMacPlatform(platform)) {
    return {
      label: "Mac input permissions",
      done: permissions.captureEngine === "ready",
      detail: "Grant Input Monitoring and Accessibility on the Mac sender."
    };
  }

  return {
    label: "Input readiness",
    done: permissions.captureEngine === "ready" || permissions.injectionEngine === "ready",
    detail: "Validate the platform input engine before running input smoke tests."
  };
}

function mvpDiscoveryStep(platform: string, devices: Device[]) {
  const hasPeer = devices.some((device) => device.online || device.connection === "manual");

  if (isWindowsPlatform(platform)) {
    return {
      label: "Find Mac sender",
      done: hasPeer,
      detail: "Scan LAN, or copy the Mac endpoint into Manual pair."
    };
  }

  return {
    label: "Find Windows client",
    done: hasPeer,
    detail: "Scan LAN, or copy the Windows endpoint into Manual pair."
  };
}

function mvpReceiveStep(
  platform: string,
  role: ComputerRole,
  allowIncomingControl: boolean,
  trustedDevices: Device[]
) {
  if (isWindowsPlatform(platform)) {
    return {
      label: "Enable receive",
      done:
        canReceiveInput(role) &&
        allowIncomingControl &&
        trustedDevices.some((device) => device.allowIncomingControl),
      detail: "Use Enable or turn on Allow incoming control and Receive for the trusted Mac row."
    };
  }

  if (isMacPlatform(platform)) {
    return {
      label: "Windows receive setup",
      done: trustedDevices.some(
        (device) =>
          (device.role === "client" || device.role === "both") && device.inputControlReady
      ),
      detail: "On Windows, use Enable or turn on Allow incoming control and Receive before Test."
    };
  }

  return {
    label: "Enable receive",
    done: allowIncomingControl && trustedDevices.some((device) => device.allowIncomingControl),
    detail: "Enable incoming control on the receiver before sending input."
  };
}

function pairingCodeEntryState(pairing: PendingPairing, enteredCode: string) {
  if (pairing.localApproved) {
    return {
      canConfirm: false,
      message: "Approved locally",
      error: false
    };
  }

  if (enteredCode.length === 0) {
    return {
      canConfirm: false,
      message: "Type other code",
      error: false
    };
  }

  if (enteredCode.length < 6) {
    const remainingDigits = 6 - enteredCode.length;
    return {
      canConfirm: false,
      message: `${remainingDigits} ${remainingDigits === 1 ? "digit" : "digits"} left`,
      error: false
    };
  }

  if (enteredCode !== pairing.code) {
    return {
      canConfirm: false,
      message: "Code mismatch",
      error: true
    };
  }

  return {
    canConfirm: true,
    message: "Codes match",
    error: false
  };
}

function statusValueLabel(value: PermissionState | EngineState | ServiceHealthState) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function serviceHealthDetail(label: string, service: ServiceHealthStatus) {
  return `${label}: ${service.detail}`;
}

function commandErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected app command failure.";
}

async function invokeNetworkAction(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<NetworkAction>(command, args);
  } catch (error) {
    return {
      ok: false,
      message: `${command.replace(/_/g, " ")} failed: ${commandErrorMessage(error)}`
    };
  }
}

function captureButtonTitle(captureReady: boolean, captureActive: boolean, role: ComputerRole) {
  if (captureActive) return "Stop the current capture session before switching devices.";
  if (!canSendInput(role)) return "Set this computer role to Main or Both before capture.";
  if (!captureReady) return "Native capture is not ready on this OS or permission state.";
  return "Forward local keyboard and mouse input to this trusted device.";
}

function inputReadiness(permissions: InputPermissionStatus, platform: string) {
  const normalizedPlatformValue = normalizedPlatform(platform);
  const captureReady = permissions.captureEngine === "ready";
  const injectionReady = permissions.injectionEngine === "ready";

  if (captureReady && injectionReady) {
    return {
      state: "Input ready",
      detail: "Capture and injection engines are available.",
      action: "Use Test first, then Capture."
    };
  }

  if (isMacPlatform(platform)) {
    if (permissions.accessibility === "missing" && permissions.inputMonitoring === "missing") {
      return {
        state: "macOS permissions missing",
        detail: "Accessibility and Input Monitoring are both required for full input sharing.",
        action: "Open Privacy & Security, grant both permissions, then restart RemoteShare."
      };
    }

    if (permissions.accessibility === "missing") {
      return {
        state: "Injection blocked",
        detail: "macOS Accessibility is missing.",
        action: "Grant Accessibility, then retry Test."
      };
    }

    if (permissions.inputMonitoring === "missing") {
      return {
        state: "Capture blocked",
        detail: "macOS Input Monitoring is missing.",
        action: "Grant Input Monitoring, then restart RemoteShare."
      };
    }
  }

  if (isWindowsPlatform(platform)) {
    return {
      state: injectionReady ? "Windows receive ready" : "Windows input pending",
      detail: "Windows injection is available; local capture is planned for a later milestone.",
      action: "Use this computer as receiver for the first Test flow."
    };
  }

  if (normalizedPlatformValue.includes("linux")) {
    return {
      state: "Linux input planned",
      detail: "Linux capture and injection need an X11/Wayland implementation.",
      action: "Validate pairing and reconnect before input forwarding."
    };
  }

  return {
    state: "Input pending",
    detail: `Capture ${statusValueLabel(permissions.captureEngine)} · Inject ${statusValueLabel(
      permissions.injectionEngine
    )}.`,
    action: "Check OS permissions and platform support."
  };
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function App() {
  const [status, setStatus] = useState<RuntimeStatus>(fallbackStatus);
  const [permissions, setPermissions] = useState<InputPermissionStatus>(fallbackPermissions);
  const [loading, setLoading] = useState(false);
  const [manualEndpoint, setManualEndpoint] = useState("");
  const [manualEndpointDirty, setManualEndpointDirty] = useState(false);
  const [endpointUpdateDeviceId, setEndpointUpdateDeviceId] = useState<string | null>(null);
  const [localEndpoints, setLocalEndpoints] = useState<string[]>([]);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [checkingTrustedDevices, setCheckingTrustedDevices] = useState(false);
  const [pairingCodeEntries, setPairingCodeEntries] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState(false);

  function showActionMessage(message: string, error = false) {
    setActionMessage(message);
    setActionError(error);
  }

  async function refreshStatus(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const next = await invoke<RuntimeStatus>("runtime_status");
      setStatus(next);
      const endpoints = await invoke<string[]>("local_control_endpoints");
      setLocalEndpoints(endpoints);
      const nextPermissions = await invoke<InputPermissionStatus>("input_permission_status");
      setPermissions(nextPermissions);
    } catch {
      setStatus(fallbackStatus);
      setPermissions(fallbackPermissions);
      setLocalEndpoints([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    refreshStatus();
    const unlistenDevices = listen("remoteshare://devices-changed", () => {
      refreshStatus();
    });
    const unlistenErrors = listen<string>("remoteshare://network-error", (event) => {
      showActionMessage(event.payload, true);
      refreshStatus(false);
    });
    const statusInterval = window.setInterval(() => {
      refreshStatus(false);
    }, 5000);

    return () => {
      window.clearInterval(statusInterval);
      unlistenDevices.then((dispose) => dispose());
      unlistenErrors.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (!manualEndpointDirty) {
      setManualEndpoint(status.discovery.manualEndpoint ?? "");
    }
  }, [manualEndpointDirty, status.discovery.manualEndpoint]);

  async function scanLan() {
    setLoading(true);
    try {
      const action = await invokeNetworkAction("start_lan_discovery");
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  }

  async function submitManualConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualEndpoint.trim()) return;

    setLoading(true);
    try {
      const action = endpointUpdateDeviceId
        ? await invokeNetworkAction("update_trusted_endpoint", {
            request: { deviceId: endpointUpdateDeviceId, endpoint: manualEndpoint.trim() }
          })
        : await invokeNetworkAction("initiate_pairing", {
            request: { endpoint: manualEndpoint.trim(), manualEndpoint: true }
          });
      showActionMessage(action.message, !action.ok);
      if (action.ok) {
        setManualEndpointDirty(false);
        setEndpointUpdateDeviceId(null);
      }
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  }

  async function clearManualEndpoint() {
    const action = await invokeNetworkAction("clear_manual_endpoint");
    showActionMessage(action.message, !action.ok);
    if (action.ok) {
      setManualEndpoint("");
      setManualEndpointDirty(false);
      setEndpointUpdateDeviceId(null);
    }
    await refreshStatus();
  }

  function editManualEndpoint(device: Device) {
    setManualEndpoint(device.lastConnectionFailure?.endpoint ?? device.endpoint ?? "");
    setManualEndpointDirty(true);
    setEndpointUpdateDeviceId(device.id);
    showActionMessage(`Update IP field set for ${device.name}. Paste the current endpoint, then verify it.`);
  }

  async function copyLocalEndpoint(endpoint: string) {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopiedEndpoint(endpoint);
      showActionMessage(`Copied ${endpoint}.`);
      window.setTimeout(() => setCopiedEndpoint(null), 1800);
    } catch {
      showActionMessage(`Copy failed. Endpoint: ${endpoint}`, true);
    }
  }

  async function copyAuditFingerprint(label: string, fingerprint: string | null) {
    if (!fingerprint) {
      showActionMessage(`${label} fingerprint unavailable.`, true);
      return;
    }

    try {
      await navigator.clipboard.writeText(fingerprint);
      showActionMessage(`Copied ${label} fingerprint.`);
    } catch {
      showActionMessage(`Copy failed. Fingerprint: ${fingerprint}`, true);
    }
  }

  async function copyFingerprint(device: Device) {
    if (!device.publicKeyFingerprint) {
      showActionMessage("Fingerprint unavailable for this device.", true);
      return;
    }

    try {
      await navigator.clipboard.writeText(device.publicKeyFingerprint);
      showActionMessage(`Copied full fingerprint for ${device.name}.`);
    } catch {
      showActionMessage(`Copy failed. Fingerprint: ${device.publicKeyFingerprint}`, true);
    }
  }

  async function pairDevice(device: Device) {
    const action = await invokeNetworkAction("initiate_pairing", {
      request: pairRequestForDevice(device)
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function confirmPairing(pairing: PendingPairing) {
    const enteredCode = pairingCodeEntries[pairing.id]?.trim() ?? "";
    if (!/^\d{6}$/.test(enteredCode)) {
      showActionMessage("Enter the six-digit code from the other computer before confirming.", true);
      return;
    }

    const action = await invokeNetworkAction("confirm_pairing", {
      request: { pairingId: pairing.id, code: enteredCode }
    });
    showActionMessage(action.message, !action.ok);
    if (action.ok) {
      setPairingCodeEntries((entries) => {
        const next = { ...entries };
        delete next[pairing.id];
        return next;
      });
    }
    await refreshStatus();
  }

  async function cancelPairing(pairing: PendingPairing) {
    const action = await invokeNetworkAction("cancel_pairing", {
      request: { pairingId: pairing.id }
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function updateSetting(
    key: "role" | "autoStart" | "trustedReconnect" | "privateNetworkOnly" | "allowIncomingControl",
    value: boolean | ComputerRole
  ) {
    const action = await invokeNetworkAction("update_settings", {
      request: { [key]: value }
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function updateDeviceControl(device: Device, value: boolean) {
    const action = await invokeNetworkAction("update_device_control", {
      request: { deviceId: device.id, allowIncomingControl: value }
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function enableReceiveForTrustedDevices() {
    const action = await invokeNetworkAction("enable_receive_for_trusted_devices");
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function forgetTrustedDevice(device: Device) {
    const confirmed = window.confirm(`Forget trusted device "${device.name}"?`);
    if (!confirmed) return;

    const action = await invokeNetworkAction("forget_trusted_device", {
      request: { deviceId: device.id }
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function requestInputPermissions() {
    try {
      const nextPermissions = await invoke<InputPermissionStatus>("request_input_permissions");
      setPermissions(nextPermissions);
      showActionMessage("Input permission request sent.");
      await refreshStatus(false);
    } catch (error) {
      showActionMessage(`Input permission request failed: ${commandErrorMessage(error)}`, true);
      await refreshStatus(false);
    }
  }

  async function sendTestInput(device: Device) {
    if (!canSendInput(status.mode)) {
      showActionMessage("Set this computer role to Main or Both before sending test input.", true);
      return;
    }

    const action = await invokeNetworkAction("send_test_input", {
      request: { deviceId: device.id }
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function checkTrustedDevice(device: Device) {
    if (!status.trustedReconnect) {
      showActionMessage("Turn on Auto reconnect before running trusted checks.", true);
      return;
    }

    const action = await invokeNetworkAction("check_trusted_device", {
      request: { deviceId: device.id }
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function checkAllTrustedDevices() {
    if (checkingTrustedDevices) return;
    if (!status.trustedReconnect) {
      showActionMessage("Turn on Auto reconnect before checking trusted devices.", true);
      return;
    }
    if (reachableTrustedDevices.length === 0) {
      showActionMessage("No trusted devices have a known endpoint for reconnect checks.", true);
      return;
    }

    setCheckingTrustedDevices(true);
    try {
      let reachableCount = 0;
      let lastFailure = "";
      for (const device of reachableTrustedDevices) {
        const action = await invokeNetworkAction("check_trusted_device", {
          request: { deviceId: device.id }
        });
        if (action.ok) {
          reachableCount += 1;
        } else {
          lastFailure = action.message;
        }
      }

      showActionMessage(
        lastFailure
          ? `Checked ${reachableTrustedDevices.length}; ${reachableCount} reachable. Last failure: ${lastFailure}`
          : `Checked ${reachableCount} trusted device${reachableCount === 1 ? "" : "s"}.`,
        Boolean(lastFailure)
      );
      await refreshStatus();
    } finally {
      setCheckingTrustedDevices(false);
    }
  }

  async function startCapture(device: Device) {
    if (!canSendInput(status.mode)) {
      showActionMessage("Set this computer role to Main or Both before starting capture.", true);
      return;
    }

    const action = await invokeNetworkAction("start_capture", {
      request: { deviceId: device.id }
    });
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  async function stopCapture() {
    const action = await invokeNetworkAction("stop_capture");
    showActionMessage(action.message, !action.ok);
    await refreshStatus();
  }

  const trustedDevices = useMemo(
    () => status.devices.filter((device) => device.trusted),
    [status.devices]
  );
  const trustedDevicesNeedingReceive = useMemo(
    () => trustedDevices.filter((device) => !device.allowIncomingControl),
    [trustedDevices]
  );
  const receiveShortcutAvailable =
    canReceiveInput(status.mode) &&
    trustedDevices.length > 0 &&
    (!status.allowIncomingControl || trustedDevicesNeedingReceive.length > 0);
  const reachableTrustedDevices = useMemo(
    () => trustedDevices.filter((device) => device.endpoint && device.inputControlReady),
    [trustedDevices]
  );
  const reconnectChecksAvailable =
    status.trustedReconnect && reachableTrustedDevices.length > 0;
  const captureTarget = useMemo(
    () => trustedDevices.find((device) => device.id === status.capture.targetDeviceId),
    [status.capture.targetDeviceId, trustedDevices]
  );
  const discoveredDevices = useMemo(
    () =>
      status.devices.filter(
        (device) => device.online && device.endpointSource === "discovery"
      ),
    [status.devices]
  );
  const savedEndpointDevices = useMemo(
    () => trustedDevices.filter((device) => device.endpointSource === "saved"),
    [trustedDevices]
  );
  const trustedDevicesNeedingEndpoint = useMemo(
    () => trustedDevices.filter((device) => device.inputControlReady && !device.endpoint),
    [trustedDevices]
  );
  const failedTrustedDevices = useMemo(
    () => trustedDevices.filter((device) => device.lastConnectionFailure),
    [trustedDevices]
  );
  const connectionPath = useMemo(() => {
    if (discoveredDevices.length > 0) {
      return {
        state: "LAN auto-detect",
        detail: `${plural(discoveredDevices.length, "computer")} visible on UDP ${status.discovery.discoveryPort}.`
      };
    }

    if (status.discovery.manualEndpoint) {
      return {
        state: "Manual fallback",
        detail: status.discovery.manualEndpoint
      };
    }

    if (savedEndpointDevices.length > 0) {
      return {
        state: "Saved endpoints",
        detail: `${plural(savedEndpointDevices.length, "trusted computer")} ready for reconnect checks.`
      };
    }

    if (trustedDevicesNeedingEndpoint.length > 0) {
      return {
        state: "Endpoint needed",
        detail: `${plural(trustedDevicesNeedingEndpoint.length, "trusted computer")} can use Set IP and Verify IP.`
      };
    }

    return {
      state: "No active path",
      detail: "Waiting for LAN discovery or a manual endpoint."
    };
  }, [
    discoveredDevices.length,
    savedEndpointDevices.length,
    status.discovery.discoveryPort,
    status.discovery.manualEndpoint,
    trustedDevicesNeedingEndpoint.length
  ]);
  const inputDiagnostic = useMemo(
    () => inputReadiness(permissions, status.platform),
    [permissions, status.platform]
  );
  const captureReady = permissions.captureEngine === "ready";
  const sendRoleReady = canSendInput(status.mode);
  const receiveRoleReady = canReceiveInput(status.mode);
  const roleStep = useMemo(
    () => mvpRoleStep(status.platform, status.mode),
    [status.mode, status.platform]
  );
  const permissionStep = useMemo(
    () => mvpInputPermissionStep(status.platform, permissions),
    [permissions, status.platform]
  );
  const discoveryStep = useMemo(
    () => mvpDiscoveryStep(status.platform, status.devices),
    [status.devices, status.platform]
  );
  const receiveStep = useMemo(
    () =>
      mvpReceiveStep(
        status.platform,
        status.mode,
        status.allowIncomingControl,
        trustedDevices
      ),
    [status.allowIncomingControl, status.mode, status.platform, trustedDevices]
  );
  const setupSteps = useMemo(
    () => [
      {
        label: "Choose roles",
        done: roleStep.done,
        detail: roleStep.detail
      },
      {
        label: permissionStep.label,
        done: permissionStep.done,
        detail: permissionStep.detail
      },
      {
        label: discoveryStep.label,
        done: discoveryStep.done,
        detail: discoveryStep.detail
      },
      {
        label: "Trust the pair",
        done: trustedDevices.length > 0,
        detail: "Type the same six-digit code and confirm on both computers."
      },
      {
        label: receiveStep.label,
        done: receiveStep.done,
        detail: receiveStep.detail
      },
      {
        label: "Verify input",
        done: status.recentInputEvents.some(
          (event) => event.accepted && event.summary.includes("key press r")
        ),
        detail: "Use Test from the Mac sender and confirm the Windows client logs key press r."
      }
    ],
    [
      permissionStep.detail,
      permissionStep.done,
      permissionStep.label,
      discoveryStep.detail,
      discoveryStep.done,
      discoveryStep.label,
      status.recentInputEvents,
      receiveStep.detail,
      receiveStep.done,
      receiveStep.label,
      roleStep.detail,
      roleStep.done,
      trustedDevices
    ]
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <MousePointer2 size={20} />
          </div>
          <div>
            <h1>RemoteShare</h1>
            <p>{status.thisDevice}</p>
          </div>
        </div>

        <div className="setup-checklist" aria-label="Mac to Windows setup checklist">
          <span>{"Mac main -> Windows client"}</span>
          {setupSteps.map((step) => (
            <div className={`setup-step ${step.done ? "setup-step-done" : ""}`} key={step.label}>
              {step.done ? <CheckCircle2 size={16} /> : <CircleDot size={16} />}
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Keyboard and mouse sharing</p>
            <h2>Trusted devices reconnect automatically.</h2>
            <span className="device-fingerprint">
              {status.platform} · {roleLabel(status.mode)} · {status.thisDeviceId}
            </span>
          </div>
          <button className="icon-button" onClick={() => refreshStatus()} aria-label="Refresh devices">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </header>

        <section className="status-grid">
          <div className="metric">
            <Monitor size={18} />
            <div>
              <span>This computer</span>
              <strong>{roleLabel(status.mode)}</strong>
            </div>
          </div>
          <div className="metric">
            <Wifi size={18} />
            <div>
              <span>Discovery</span>
              <strong>
                {status.discovery.serviceType}:{status.discovery.discoveryPort}
              </strong>
            </div>
          </div>
          <div className="metric">
            <PlugZap size={18} />
            <div>
              <span>Auto reconnect</span>
              <strong>{status.trustedReconnect ? "On" : "Off"}</strong>
            </div>
            <button
              className="secondary-button compact"
              disabled={checkingTrustedDevices || !reconnectChecksAvailable}
              onClick={checkAllTrustedDevices}
              title={
                status.trustedReconnect
                  ? "Run trusted reconnect checks for all reachable trusted devices."
                  : "Turn on Auto reconnect to run trusted checks."
              }
              type="button"
            >
              {checkingTrustedDevices ? "Checking" : "Check"}
            </button>
          </div>
          <div className="metric">
            <ShieldCheck size={18} />
            <div>
              <span>Trusted pairs</span>
              <strong>{trustedDevices.length}</strong>
            </div>
          </div>
          <div className="metric">
            <Keyboard size={18} />
            <div>
              <span>Input control</span>
              <strong>
                {status.capture.active
                  ? "Capturing"
                  : receiveRoleReady && status.allowIncomingControl
                    ? "Receive on"
                    : reachableTrustedDevices.length > 0
                      ? "Send ready"
                      : "Locked"}
              </strong>
              <small>
                {status.capture.active
                  ? `Target ${captureTarget?.name ?? "trusted device"} · started ${elapsedLabel(
                      status.capture.startedAtMs ?? Date.now()
                    )}`
                  : `Capture ${statusValueLabel(permissions.captureEngine)} · Inject ${statusValueLabel(
                      permissions.injectionEngine
                    )}`}
              </small>
            </div>
            {receiveShortcutAvailable && (
              <button
                className="secondary-button compact"
                onClick={enableReceiveForTrustedDevices}
                title="Enable incoming control for trusted devices."
                type="button"
              >
                Enable
              </button>
            )}
          </div>
          <div className="metric">
            <ShieldCheck size={18} />
            <div>
              <span>Permissions</span>
              <strong>
                Accessibility {statusValueLabel(permissions.accessibility)}
              </strong>
              <small>
                Input Monitoring {statusValueLabel(permissions.inputMonitoring)} · Native input{" "}
                {statusValueLabel(permissions.inputInjection)}
              </small>
            </div>
            <button
              className="secondary-button compact"
              onClick={requestInputPermissions}
              type="button"
            >
              Request
            </button>
          </div>
        </section>

        <section className="path-panel" aria-label="Connection path diagnostics">
          <div className="path-card path-card-primary">
            <Network size={18} />
            <div>
              <span>Connection path</span>
              <strong>{connectionPath.state}</strong>
              <small>{connectionPath.detail}</small>
            </div>
          </div>
          <div className="path-card">
            <Monitor size={18} />
            <div>
              <span>This computer</span>
              <strong>{localEndpoints.length > 0 ? "Endpoint visible" : "Endpoint unknown"}</strong>
              {localEndpoints.length > 0 ? (
                <div className="endpoint-list">
                  {localEndpoints.map((endpoint) => (
                    <button
                      className="endpoint-copy"
                      key={endpoint}
                      onClick={() => copyLocalEndpoint(endpoint)}
                      type="button"
                      title={`Copy ${endpoint}`}
                    >
                      <Copy size={13} />
                      {copiedEndpoint === endpoint ? "Copied" : endpoint}
                    </button>
                  ))}
                  <small className="endpoint-hint">
                    Prefer the IPv4 address on the same Wi-Fi/LAN subnet; IPv6 is available for manual fallback.
                  </small>
                </div>
              ) : (
                <small>TCP {status.discovery.port}</small>
              )}
            </div>
          </div>
          <div className="path-card">
            <Link size={18} />
            <div>
              <span>Different subnet</span>
              <strong>{status.discovery.manualEndpoint ? "Manual saved" : "Manual ready"}</strong>
              <small>{status.discovery.manualEndpoint ?? "host, IP, or host:port"}</small>
            </div>
          </div>
          <div className={`path-card ${failedTrustedDevices.length > 0 ? "path-card-warning" : ""}`}>
            <PlugZap size={18} />
            <div>
              <span>Reconnect health</span>
              <strong>
                {failedTrustedDevices.length > 0
                  ? plural(failedTrustedDevices.length, "failure")
                  : "No failures"}
              </strong>
              <small>
                {failedTrustedDevices[0]?.lastConnectionFailure?.message ??
                  `${plural(reachableTrustedDevices.length, "trusted endpoint")} reachable`}
              </small>
            </div>
          </div>
          <div
            className={`path-card ${
              status.networkHealth.startupRegistration.state === "failed" ||
              status.networkHealth.controlListener.state === "failed" ||
              status.networkHealth.discovery.state === "failed"
                ? "path-card-warning"
                : ""
            }`}
          >
            <ShieldCheck size={18} />
            <div>
              <span>Startup health</span>
              <strong>
                TCP {statusValueLabel(status.networkHealth.controlListener.state)} · UDP{" "}
                {statusValueLabel(status.networkHealth.discovery.state)}
              </strong>
              <small>
                Start {statusValueLabel(status.networkHealth.startupRegistration.state)} ·{" "}
                {status.networkHealth.lastReconnectAttemptAtMs
                  ? `Reconnect ${lastSeenLabel(status.networkHealth.lastReconnectAttemptAtMs)}`
                  : `Started ${lastSeenLabel(status.networkHealth.startedAtMs)}`}
              </small>
              <small className="startup-health-detail">
                {serviceHealthDetail("TCP", status.networkHealth.controlListener)}
                <br />
                {serviceHealthDetail("UDP", status.networkHealth.discovery)}
                <br />
                {serviceHealthDetail("Start", status.networkHealth.startupRegistration)}
              </small>
            </div>
          </div>
        </section>

        <section className="input-readiness-panel" aria-label="Input readiness diagnostics">
          <div>
            <span>Input readiness</span>
            <strong>{inputDiagnostic.state}</strong>
            <small>{inputDiagnostic.detail}</small>
          </div>
          <div>
            <span>Next action</span>
            <strong>{inputDiagnostic.action}</strong>
            <small>
              Capture {statusValueLabel(permissions.captureEngine)} · Inject{" "}
              {statusValueLabel(permissions.injectionEngine)}
            </small>
          </div>
          <button
            className="secondary-button compact"
            onClick={requestInputPermissions}
            type="button"
          >
            Request
          </button>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Nearby Computers</h3>
              <p>Pair once with approval on both computers, then reconnect after restart, wake, or Wi-Fi changes.</p>
            </div>
            <button className="primary-button" onClick={scanLan} disabled={loading}>
              Scan LAN
            </button>
          </div>

          <div className="device-list">
            {status.devices.length === 0 && (
              <div className="empty-state">
                <Wifi size={22} />
                <div>
                  <h4>No trusted devices yet</h4>
                  <p>Scan the LAN or connect manually, then approve pairing on both computers.</p>
                </div>
              </div>
            )}
            {status.devices.map((device) => (
              <article className="device-row" key={device.id}>
                <div className="device-icon">
                  <Monitor size={22} />
                </div>
                <div className="device-main">
                  <div className="device-title">
                    <h4>{device.name}</h4>
                    {device.trusted && (
                      <span className="trust-badge">
                        <CheckCircle2 size={14} />
                        Trusted
                      </span>
                    )}
                  </div>
                  <p>
                    {device.platform} · {roleLabel(device.role)} · {connectionLabel(device)}
                  </p>
                  <p className="device-diagnostic-row">
                    {lastSeenLabel(device.lastSeenAtMs)} · {endpointDiagnostic(device)}
                  </p>
                  {device.lastConnectionFailure && (
                    <p className="device-failure-row">
                      {connectionFailureDiagnostic(device)}
                      <span>{connectionFailureHint(device)}</span>
                    </p>
                  )}
                  {device.trusted && (
                    <p className="device-fingerprint-row">
                      Key {shortFingerprint(device.publicKeyFingerprint)}
                      {device.publicKeyFingerprint && (
                        <button
                          className="fingerprint-copy"
                          onClick={() => copyFingerprint(device)}
                          title={`Full fingerprint: ${device.publicKeyFingerprint}`}
                          type="button"
                        >
                          <Copy size={12} />
                          Key
                        </button>
                      )}
                    </p>
                  )}
                </div>
                <span className={device.online ? "online-dot" : "offline-dot"}>
                  <CircleDot size={16} />
                </span>
                {!device.trusted && (device.online || device.connection === "manual") && (
                  <button className="secondary-button compact" onClick={() => pairDevice(device)}>
                    Pair
                  </button>
                )}
                {device.trusted && device.endpoint && !device.inputControlReady && (
                  <button className="secondary-button compact" onClick={() => pairDevice(device)}>
                    Re-pair
                  </button>
                )}
                {device.trusted && !device.endpoint && !device.inputControlReady && (
                  <span className="warning-badge">Re-pair</span>
                )}
                {device.trusted && device.endpoint && device.inputControlReady && (
                  <button
                    className="secondary-button compact"
                    disabled={!status.trustedReconnect}
                    onClick={() => checkTrustedDevice(device)}
                    title={
                      status.trustedReconnect
                        ? "Run an authenticated reconnect check for this device."
                        : "Turn on Auto reconnect to run trusted checks."
                    }
                  >
                    Check
                  </button>
                )}
                {canEditTrustedEndpoint(device) && (
                  <button
                    className="secondary-button compact"
                    onClick={() => editManualEndpoint(device)}
                    title="Verify a new endpoint for this trusted device without pairing again."
                  >
                    {device.endpoint ? "Edit IP" : "Set IP"}
                  </button>
                )}
                {device.trusted && device.endpoint && device.inputControlReady && (
                  <button
                    className="secondary-button compact"
                    disabled={!sendRoleReady}
                    onClick={() => sendTestInput(device)}
                    title={
                      sendRoleReady
                        ? "Send a trusted test input event to this device."
                        : "Set this computer role to Main or Both before sending input."
                    }
                  >
                    Test
                  </button>
                )}
                {device.trusted && device.endpoint && device.inputControlReady && (
                  status.capture.active && status.capture.targetDeviceId === device.id ? (
                    <button className="secondary-button compact" onClick={stopCapture}>
                      Stop
                    </button>
                  ) : (
                    <button
                      className="secondary-button compact"
                      disabled={status.capture.active || !captureReady || !sendRoleReady}
                      onClick={() => startCapture(device)}
                      title={captureButtonTitle(captureReady, status.capture.active, status.mode)}
                    >
                      Capture
                    </button>
                  )
                )}
                {device.trusted && (
                  <button
                    className="secondary-button compact"
                    onClick={() => forgetTrustedDevice(device)}
                  >
                    Forget
                  </button>
                )}
                {device.trusted && (
                  <label
                    className={`row-toggle ${device.inputControlReady ? "" : "row-toggle-disabled"}`}
                    title={
                      !receiveRoleReady
                        ? "Set this computer role to Client or Both before receiving input."
                        : device.inputControlReady
                        ? "Allow this trusted device to control this computer."
                        : "Re-pair this device before enabling receive."
                    }
                  >
                    <span>Receive</span>
                    <input
                      type="checkbox"
                      checked={device.allowIncomingControl}
                      disabled={!device.inputControlReady || !receiveRoleReady}
                      onChange={(event) => updateDeviceControl(device, event.target.checked)}
                    />
                    {!device.inputControlReady && <em>Re-pair</em>}
                  </label>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="panel input-panel">
          <div className="panel-heading">
            <div>
              <h3>Input Transport</h3>
              <p>Trusted transport and native injection results are logged here.</p>
            </div>
          </div>
          {status.recentInputEvents.length === 0 ? (
            <div className="empty-state">
              <Keyboard size={22} />
              <div>
                <h4>No input events yet</h4>
                <p>After enabling receive permission, use Test on a trusted device to verify transport.</p>
              </div>
            </div>
          ) : (
            <div className="event-list">
              {status.recentInputEvents.map((event) => {
                const deviceLabel = inputEventDeviceLabel(event, status.devices);
                return (
                  <div
                    className={`event-row ${event.accepted ? "event-row-success" : "event-row-failed"}`}
                    key={`${event.atMs}-${event.deviceId}`}
                  >
                    <Keyboard size={16} />
                    <span>{event.direction}</span>
                    <strong>{event.summary}</strong>
                    <small>
                      {deviceLabel} · {elapsedLabel(event.atMs)}
                    </small>
                    <em>{inputEventStatusLabel(event)}</em>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel audit-panel" aria-label="Trusted device audit">
          <div className="panel-heading">
            <div>
              <h3>Trusted Device Audit</h3>
              <p>Full trust fingerprints, endpoint source, receive permission, and reconnect state.</p>
            </div>
          </div>
          <div className="audit-local">
            <span>This computer</span>
            <strong>{status.thisDevice}</strong>
            <div className="audit-fingerprint">
              <code>{status.thisPublicKeyFingerprint}</code>
              <button
                className="fingerprint-copy"
                onClick={() => copyAuditFingerprint("local", status.thisPublicKeyFingerprint)}
                title="Copy local full fingerprint"
                type="button"
              >
                <Copy size={12} />
                Key
              </button>
            </div>
          </div>
          {trustedDevices.length === 0 ? (
            <div className="empty-state">
              <ShieldCheck size={22} />
              <div>
                <h4>No trusted devices</h4>
                <p>Completed pairings will appear here with full key and endpoint details.</p>
              </div>
            </div>
          ) : (
            <div className="audit-list">
              {trustedDevices.map((device) => (
                <article className="audit-row" key={device.id}>
                  <div>
                    <span>{device.platform} · {roleLabel(device.role)}</span>
                    <strong>{device.name}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Role</dt>
                      <dd>{roleLabel(device.role)}</dd>
                    </div>
                    <div>
                      <dt>Fingerprint</dt>
                      <dd className="audit-fingerprint">
                        <span>{device.publicKeyFingerprint ?? "unavailable"}</span>
                        {device.publicKeyFingerprint && (
                          <button
                            className="fingerprint-copy"
                            onClick={() => copyAuditFingerprint(device.name, device.publicKeyFingerprint)}
                            title={`Copy full fingerprint for ${device.name}`}
                            type="button"
                          >
                            <Copy size={12} />
                            Key
                          </button>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Endpoint</dt>
                      <dd>{device.endpoint ? `${endpointSourceLabel(device)} · ${device.endpoint}` : "none"}</dd>
                    </div>
                    <div>
                      <dt>Last seen</dt>
                      <dd>{lastSeenLabel(device.lastSeenAtMs)}</dd>
                    </div>
                    <div>
                      <dt>Receive</dt>
                      <dd>{device.allowIncomingControl ? "enabled" : "disabled"}</dd>
                    </div>
                    <div>
                      <dt>Input secret</dt>
                      <dd>{device.inputControlReady ? "ready" : "re-pair needed"}</dd>
                    </div>
                    <div>
                      <dt>Last failure</dt>
                      <dd>
                        {connectionFailureDiagnostic(device) ?? "none"}
                        {device.lastConnectionFailure && (
                          <span className="audit-failure-hint">{connectionFailureHint(device)}</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>

        {status.pendingPairings.length > 0 && (
          <section className="panel pairing-panel">
            <div className="panel-heading">
              <div>
                <h3>Pairing Requests</h3>
                <p>Approve only when the same code is visible on both computers.</p>
              </div>
            </div>
            <div className="device-list">
              {status.pendingPairings.map((pairing) => {
                const enteredCode = pairingCodeEntries[pairing.id] ?? "";
                const entryState = pairingCodeEntryState(pairing, enteredCode);

                return (
                  <article className="pairing-row" key={pairing.id}>
                    <div>
                      <h4>{pairing.name}</h4>
                      <p>
                        {pairing.platform} · {roleLabel(pairing.role)} · {pairing.endpoint} ·{" "}
                        {pairing.direction} · {pairingExpiryLabel(pairing)}
                      </p>
                      <div className="approval-status">
                        <span className={pairing.localApproved ? "approved" : "pending"}>
                          Local {approvalLabel(pairing.localApproved)}
                        </span>
                        <span className={pairing.remoteApproved ? "approved" : "pending"}>
                          Remote {approvalLabel(pairing.remoteApproved)}
                        </span>
                      </div>
                    </div>
                    <strong className="pairing-code">{pairing.code}</strong>
                    <label className="pairing-code-entry">
                      <input
                        className={`pairing-code-input ${entryState.error ? "input-error" : ""}`}
                        inputMode="numeric"
                        maxLength={6}
                        pattern="[0-9]{6}"
                        placeholder="Other code"
                        value={enteredCode}
                        disabled={pairing.localApproved}
                        onChange={(event) =>
                          setPairingCodeEntries((entries) => ({
                            ...entries,
                            [pairing.id]: event.target.value.replace(/\D/g, "").slice(0, 6)
                          }))
                        }
                      />
                      <span className={`pairing-code-hint ${entryState.error ? "error" : ""}`}>
                        {entryState.message}
                      </span>
                    </label>
                    <button
                      className="primary-button"
                      disabled={!entryState.canConfirm}
                      onClick={() => confirmPairing(pairing)}
                    >
                      {pairing.localApproved ? "Waiting" : "Confirm"}
                    </button>
                    <button
                      className="secondary-button compact"
                      onClick={() => cancelPairing(pairing)}
                    >
                      Cancel
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="connect-panel">
          <button className="secondary-button" onClick={scanLan} disabled={loading}>
            <Wifi size={17} />
            Scan LAN
          </button>
          <form onSubmit={submitManualConnect} className="manual-form">
            <label htmlFor="manual-endpoint">
              {endpointUpdateDeviceId ? "Update trusted IP" : "Manual pair"}
            </label>
            <div className="manual-endpoint-field">
              <input
                id="manual-endpoint"
                aria-describedby="manual-endpoint-hint"
                placeholder="host, host:port, IPv4, IPv6, or [IPv6]"
                value={manualEndpoint}
                disabled={loading}
                onChange={(event) => {
                  setManualEndpoint(event.target.value);
                  setManualEndpointDirty(true);
                }}
              />
              <small id="manual-endpoint-hint">
                Missing ports use 44777. Localhost, loopback, unspecified, and link-local IPv6 endpoints are rejected. Public IP literals are blocked while Private network only is on.
              </small>
            </div>
            <button className="secondary-button" type="submit" disabled={loading || !manualEndpoint.trim()}>
              <Link size={17} />
              {endpointUpdateDeviceId ? "Verify IP" : "Connect"}
            </button>
            {endpointUpdateDeviceId && (
              <button
                className="secondary-button"
                type="button"
                disabled={loading}
                onClick={() => {
                  setEndpointUpdateDeviceId(null);
                  setManualEndpointDirty(false);
                }}
              >
                Cancel
              </button>
            )}
            {status.discovery.manualEndpoint && (
              <button
                className="secondary-button compact"
                onClick={clearManualEndpoint}
                type="button"
                disabled={loading}
              >
                Clear
              </button>
            )}
          </form>
          <span className={actionError ? "action-message error" : "action-message"}>
            {actionMessage || status.discovery.manualEndpoint || "Ready"}
          </span>
        </section>

        <section className="settings-row">
          <label>
            <span>This computer role</span>
            <select
              value={status.mode}
              onChange={(event) => updateSetting("role", event.target.value as ComputerRole)}
            >
              <option value="main">Main</option>
              <option value="client">Client</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label>
            <span>Start at login</span>
            <input
              type="checkbox"
              checked={status.autoStart}
              onChange={(event) => updateSetting("autoStart", event.target.checked)}
            />
          </label>
          <label>
            <span>Reconnect trusted devices</span>
            <input
              type="checkbox"
              checked={status.trustedReconnect}
              onChange={(event) => updateSetting("trustedReconnect", event.target.checked)}
            />
          </label>
          <label>
            <span>Private network only</span>
            <input
              type="checkbox"
              checked={status.privateNetworkOnly}
              onChange={(event) => updateSetting("privateNetworkOnly", event.target.checked)}
            />
          </label>
          <label>
            <span>Allow incoming control</span>
            <input
              type="checkbox"
              checked={status.allowIncomingControl}
              disabled={!receiveRoleReady}
              title={
                receiveRoleReady
                  ? undefined
                  : "Set this computer role to Client or Both before enabling receive."
              }
              onChange={(event) => updateSetting("allowIncomingControl", event.target.checked)}
            />
          </label>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
