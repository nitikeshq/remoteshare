import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { localEndpointChoiceLabel } from "./endpoint-labels";
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
  endpointSource: Device["endpointSource"];
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
  detail: string | null;
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

type SetupStep = {
  label: string;
  done: boolean;
  detail: string;
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
  return endpointSourceText(device.endpointSource);
}

function endpointSourceText(source: Device["endpointSource"]) {
  if (source === "discovery") return "discovery";
  if (source === "health") return "reconnect";
  if (source === "saved") return "saved endpoint";
  if (source === "manual") return "manual IP";
  return "endpoint unknown";
}

function endpointDiagnostic(device: Device) {
  return device.endpoint ? `${endpointSourceLabel(device)} · ${device.endpoint}` : "no endpoint";
}

function connectionFailureDiagnostic(device: Device) {
  if (!device.lastConnectionFailure) return null;
  const failure = device.lastConnectionFailure;
  return `last failed ${endpointSourceText(failure.endpointSource)} ${elapsedLabel(failure.failedAtMs)} · ${failure.endpoint} · ${failure.message}`;
}

function connectionFailureHint(device: Device) {
  const failure = device.lastConnectionFailure;
  if (!failure) return null;
  if (failure.endpointSource === "saved") {
    return "Saved endpoint may be stale. Copy the current endpoint from the other computer, then use Edit IP and Verify IP.";
  }
  if (failure.endpointSource === "discovery") {
    return "Discovery found the device, but TCP control failed. Check firewall rules for port 44777.";
  }
  if (failure.endpointSource === "health") {
    return "Last reconnect endpoint may be stale. Copy the current endpoint from the other computer, then use Edit IP and Verify IP.";
  }
  if (failure.endpointSource === "manual") {
    return "Manual IP verification failed. Check the copied endpoint, firewall, and port 44777, then use Set IP and Verify IP again.";
  }
  if (device.trusted && device.inputControlReady) {
    return "Copy the current endpoint from the other computer, then use Set IP and Verify IP.";
  }
  return "Confirm both apps are open on the same reachable network, then retry or pair manually.";
}

function mostRecentConnectionFailure(devices: Device[]) {
  return devices.reduce<Device | null>((latest, device) => {
    if (!device.lastConnectionFailure) return latest;
    if (!latest?.lastConnectionFailure) return device;
    return device.lastConnectionFailure.failedAtMs > latest.lastConnectionFailure.failedAtMs
      ? device
      : latest;
  }, null);
}

function reconnectHealthDetail(device: Device | null, checkableCount: number) {
  if (!device?.lastConnectionFailure) {
    return `${plural(checkableCount, "trusted endpoint")} ready for checks`;
  }

  const hint = connectionFailureHint(device);
  return `${device.name}: ${endpointSourceText(device.lastConnectionFailure.endpointSource)} failed: ${device.lastConnectionFailure.message}${hint ? `. ${hint}` : ""}`;
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

function pairingExpiryLabel(pairing: PendingPairing, nowMs: number) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((pairing.expiresAtMs - nowMs) / 1000)
  );
  if (remainingSeconds === 0) return "expired";
  return `${remainingSeconds}s left`;
}

function pairingDirectionLabel(pairing: PendingPairing) {
  return pairing.direction === "incoming" ? "Incoming" : "Outgoing";
}

function inputEventStatusLabel(event: InputEventRecord) {
  if (event.accepted) return "Accepted";
  return event.direction === "incoming" ? "Failed" : "Rejected";
}

function inputEventDirectionLabel(event: InputEventRecord) {
  return event.direction === "incoming" ? "Incoming" : "Outgoing";
}

function inputEventDeviceLabel(event: InputEventRecord, devices: Device[]) {
  return devices.find((device) => device.id === event.deviceId)?.name ?? event.deviceId;
}

function inputEventDetailLabel(event: InputEventRecord) {
  if (event.accepted || !event.detail) return null;
  return `Reason: ${event.detail}`;
}

function inputEventEvidence(event: InputEventRecord, devices: Device[]) {
  const detail = inputEventDetailLabel(event);
  return [
    `Input Transport: ${inputEventDirectionLabel(event)}`,
    `Summary: ${event.summary}`,
    `Device: ${inputEventDeviceLabel(event, devices)}`,
    `Time: ${elapsedLabel(event.atMs)}`,
    `Status: ${inputEventStatusLabel(event)}`,
    ...(detail ? [detail] : [])
  ].join(" | ");
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
      detail:
        "Use the input-control Enable shortcut, or turn on Allow incoming control and Receive for the trusted Mac row."
    };
  }

  if (isMacPlatform(platform)) {
    return {
      label: "Windows receive setup",
      done: trustedDevices.some(
        (device) =>
          (device.role === "client" || device.role === "both") && device.inputControlReady
      ),
      detail:
        "On Windows, use the input-control Enable shortcut or turn on Allow incoming control and Receive before Test."
    };
  }

  return {
    label: "Enable receive",
    done: allowIncomingControl && trustedDevices.some((device) => device.allowIncomingControl),
    detail: "Enable incoming control on the receiver before sending input."
  };
}

function receiveShortcutLabel(allowIncomingControl: boolean, devicesNeedingReceive: number) {
  if (!allowIncomingControl && devicesNeedingReceive > 0) return "Enable all";
  if (!allowIncomingControl) return "Enable global";
  return "Enable devices";
}

function pairingCodeEntryState(pairing: PendingPairing, enteredCode: string, nowMs: number) {
  if (nowMs >= pairing.expiresAtMs) {
    return {
      canConfirm: false,
      message: "Expired; start again",
      error: true
    };
  }

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

function pairingEntryKey(pairing: PendingPairing) {
  return `${pairing.id}:${pairing.code}:${pairing.createdAtMs}:${pairing.expiresAtMs}`;
}

function pairingEvidence(pairing: PendingPairing, enteredCode: string, nowMs: number) {
  const entryState = pairingCodeEntryState(pairing, enteredCode, nowMs);
  return [
    `Pairing: ${pairingDirectionLabel(pairing)}`,
    `Device: ${pairing.name}`,
    `Endpoint: ${pairing.endpoint}`,
    `Visible code: ${pairing.code}`,
    `Typed code state: ${entryState.message}`,
    `Local: ${approvalLabel(pairing.localApproved)}`,
    `Remote: ${approvalLabel(pairing.remoteApproved)}`,
    `Expires: ${pairingExpiryLabel(pairing, nowMs)}`
  ].join("; ");
}

function statusValueLabel(value: PermissionState | EngineState | ServiceHealthState) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function serviceHealthDetail(label: string, service: ServiceHealthStatus) {
  return `${label}: ${service.detail}`;
}

function startupHealthEvidence(status: RuntimeStatus) {
  return [
    serviceHealthDetail("TCP", status.networkHealth.controlListener),
    serviceHealthDetail("UDP", status.networkHealth.discovery),
    serviceHealthDetail("Start", status.networkHealth.startupRegistration),
    status.networkHealth.lastReconnectAttemptAtMs
      ? `Reconnect: ${lastSeenLabel(status.networkHealth.lastReconnectAttemptAtMs)}`
      : `Started: ${lastSeenLabel(status.networkHealth.startedAtMs)}`
  ].join("; ");
}

function captureEvidence(status: RuntimeStatus, targetName: string | null | undefined) {
  if (!status.capture.active) {
    return "Capture: inactive";
  }

  return [
    "Capture: active",
    `Target: ${targetName ?? "trusted device"}`,
    `Started: ${elapsedLabel(status.capture.startedAtMs ?? Date.now())}`
  ].join("; ");
}

function localEndpointEvidence(status: RuntimeStatus, endpoint: string, label: string) {
  return [
    "Local endpoint",
    `This computer: ${status.thisDevice}`,
    `Label: ${label}`,
    `Endpoint: ${endpoint}`,
    `TCP port: ${status.discovery.port}`,
    `Private network only: ${status.privateNetworkOnly ? "enabled" : "disabled"}`
  ].join("; ");
}

function receiveControlEvidence(status: RuntimeStatus, device: Device) {
  return [
    "Receive control",
    `This computer: ${status.thisDevice}`,
    `Role: ${roleLabel(status.mode)}`,
    `Allow incoming control: ${status.allowIncomingControl ? "enabled" : "disabled"}`,
    `Device: ${device.name}`,
    `Device receive: ${device.allowIncomingControl ? "enabled" : "disabled"}`,
    `Input control: ${device.inputControlReady ? "ready" : "needs re-pair"}`
  ].join("; ");
}

function reconnectEvidence(status: RuntimeStatus, device: Device) {
  const failure = connectionFailureDiagnostic(device);
  const hint = connectionFailureHint(device);
  return [
    "Trusted reconnect",
    `This computer: ${status.thisDevice}`,
    `Auto reconnect: ${status.trustedReconnect ? "enabled" : "disabled"}`,
    `Device: ${device.name}`,
    `Check: ${device.online ? "reachable" : "not currently reachable"}`,
    `Last seen: ${lastSeenLabel(device.lastSeenAtMs)}`,
    `Endpoint source: ${endpointSourceLabel(device)}`,
    `Endpoint: ${device.endpoint ?? "none"}`,
    `Input control: ${device.inputControlReady ? "ready" : "needs re-pair"}`,
    `Last failure: ${failure ?? "none"}`,
    `Recovery: ${hint ?? "none"}`
  ].join("; ");
}

function setupChecklistEvidence(status: RuntimeStatus, steps: SetupStep[]) {
  return [
    "Setup",
    "Input direction: macOS sender/main -> Windows receiver/client",
    `This computer: ${status.thisDevice}`,
    `Platform: ${status.platform}`,
    `Role: ${roleLabel(status.mode)}`,
    ...steps.map((step) => `${step.label}: ${step.done ? "done" : "pending"} - ${step.detail}`)
  ].join("; ");
}

function trustedEndpointUpdateEvidence(device: Device, endpointField: string) {
  const failure = connectionFailureDiagnostic(device);
  const hint = connectionFailureHint(device);
  return [
    "Trusted IP update",
    `Device: ${device.name}`,
    `Endpoint field: ${endpointField.trim() || "empty"}`,
    `Current endpoint: ${device.endpoint ?? "none"}`,
    `Current source: ${endpointSourceLabel(device)}`,
    `Input control: ${device.inputControlReady ? "ready" : "needs re-pair"}`,
    `Last failure: ${failure ?? "none"}`,
    `Recovery: ${hint ?? "none"}`
  ].join("; ");
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

function reconnectCheckTitle(trustedReconnect: boolean, checkableCount: number) {
  if (!trustedReconnect) return "Turn on Auto reconnect to run trusted checks.";
  if (checkableCount === 0) {
    return "Pair a trusted device with a known endpoint, or use Set IP and Verify IP first.";
  }
  return "Run trusted reconnect checks for all trusted devices with a known endpoint.";
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
  const [activeActionKeys, setActiveActionKeys] = useState<Record<string, boolean>>({});
  const activeActionKeysRef = useRef<Record<string, boolean>>({});
  const [pairingCodeEntries, setPairingCodeEntries] = useState<Record<string, string>>({});
  const pairingEntryKeysRef = useRef<Record<string, string>>({});
  const [pairingNowMs, setPairingNowMs] = useState(() => Date.now());
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState(false);

  function showActionMessage(message: string, error = false) {
    setActionMessage(message);
    setActionError(error);
  }

  async function runExclusiveAction(key: string, action: () => Promise<void>) {
    if (activeActionKeysRef.current[key]) return;
    activeActionKeysRef.current = { ...activeActionKeysRef.current, [key]: true };
    setActiveActionKeys((keys) => ({ ...keys, [key]: true }));
    try {
      await action();
    } finally {
      const nextRef = { ...activeActionKeysRef.current };
      delete nextRef[key];
      activeActionKeysRef.current = nextRef;
      setActiveActionKeys((keys) => {
        const next = { ...keys };
        delete next[key];
        return next;
      });
    }
  }

  function actionIsActive(key: string) {
    return Boolean(activeActionKeys[key]);
  }

  async function refreshStatus(showLoading = true, showRefreshError = false) {
    if (showLoading) setLoading(true);
    try {
      const next = await invoke<RuntimeStatus>("runtime_status");
      setStatus(next);
      const endpoints = await invoke<string[]>("local_control_endpoints");
      setLocalEndpoints(endpoints);
      const nextPermissions = await invoke<InputPermissionStatus>("input_permission_status");
      setPermissions(nextPermissions);
    } catch (error) {
      setStatus(fallbackStatus);
      setPermissions(fallbackPermissions);
      setLocalEndpoints([]);
      if (showRefreshError) {
        showActionMessage(`Status refresh failed: ${commandErrorMessage(error)}`, true);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function refreshDeviceStatus() {
    await runExclusiveAction("refresh-status", async () => {
      await refreshStatus(true, true);
    });
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

  useEffect(() => {
    if (status.pendingPairings.length === 0) return;
    setPairingNowMs(Date.now());
    const interval = window.setInterval(() => {
      setPairingNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [status.pendingPairings.length]);

  useEffect(() => {
    const previousKeys = pairingEntryKeysRef.current;
    const currentKeys = Object.fromEntries(
      status.pendingPairings.map((pairing) => [pairing.id, pairingEntryKey(pairing)])
    );
    pairingEntryKeysRef.current = currentKeys;

    setPairingCodeEntries((entries) => {
      let changed = false;
      const nextEntries: Record<string, string> = {};

      for (const pairing of status.pendingPairings) {
        if (previousKeys[pairing.id] === currentKeys[pairing.id] && entries[pairing.id] !== undefined) {
          nextEntries[pairing.id] = entries[pairing.id];
        } else if (entries[pairing.id] !== undefined) {
          changed = true;
        }
      }

      for (const id of Object.keys(entries)) {
        if (currentKeys[id] === undefined) {
          changed = true;
        }
      }

      return changed ? nextEntries : entries;
    });
  }, [status.pendingPairings]);

  async function scanLan() {
    await runExclusiveAction("scan-lan", async () => {
      setLoading(true);
      try {
        const action = await invokeNetworkAction("start_lan_discovery");
        showActionMessage(action.message, !action.ok);
        await refreshStatus();
      } finally {
        setLoading(false);
      }
    });
  }

  function restoreManualPairAfterTrustedUpdate(message: string) {
    const copiedEndpoint = manualEndpoint.trim();
    setEndpointUpdateDeviceId(null);
    if (copiedEndpoint) {
      setManualEndpoint(copiedEndpoint);
      setManualEndpointDirty(true);
    } else {
      setManualEndpoint(status.discovery.manualEndpoint ?? "");
      setManualEndpointDirty(false);
    }
    showActionMessage(message, true);
  }

  async function submitManualConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualEndpoint.trim()) return;

    if (
      endpointUpdateDeviceId &&
      !status.devices.some(
        (device) => device.id === endpointUpdateDeviceId && device.trusted && device.inputControlReady
      )
    ) {
      restoreManualPairAfterTrustedUpdate(
        "Trusted IP update target needs re-pairing. Manual pair field kept for re-pairing."
      );
      return;
    }

    await runExclusiveAction("manual-connect", async () => {
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
    });
  }

  async function clearManualEndpoint() {
    await runExclusiveAction("clear-manual-endpoint", async () => {
      const action = await invokeNetworkAction("clear_manual_endpoint");
      showActionMessage(action.message, !action.ok);
      if (action.ok) {
        setManualEndpoint("");
        setManualEndpointDirty(false);
        setEndpointUpdateDeviceId(null);
      }
      await refreshStatus();
    });
  }

  function editManualEndpoint(device: Device) {
    setManualEndpoint(device.lastConnectionFailure?.endpoint ?? device.endpoint ?? "");
    setManualEndpointDirty(true);
    setEndpointUpdateDeviceId(device.id);
    showActionMessage(`Update IP field set for ${device.name}. Paste the current endpoint, then verify it.`);
  }

  function cancelTrustedEndpointUpdate() {
    setEndpointUpdateDeviceId(null);
    setManualEndpoint(status.discovery.manualEndpoint ?? "");
    setManualEndpointDirty(false);
    showActionMessage("Trusted IP update canceled. Manual pair field restored.");
  }

  function prepareManualRepair(device: Device) {
    setEndpointUpdateDeviceId(null);
    setManualEndpoint(device.lastConnectionFailure?.endpoint ?? "");
    setManualEndpointDirty(true);
    const endpointMessage = device.lastConnectionFailure?.endpoint
      ? `Manual pair field set to the last failed endpoint for ${device.name}. Replace it with the current endpoint if needed, then connect and confirm the new code on both computers.`
      : `Paste the current endpoint for ${device.name} into Manual pair, then connect and confirm the new code on both computers.`;
    showActionMessage(endpointMessage);
  }

  async function copyLocalEndpoint(endpoint: string, label: string) {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopiedEndpoint(endpoint);
      showActionMessage(`Copied ${label} endpoint ${endpoint}.`);
      window.setTimeout(() => setCopiedEndpoint(null), 1800);
    } catch {
      showActionMessage(`Copy failed. ${label} endpoint: ${endpoint}`, true);
    }
  }

  async function copyLocalEndpointEvidence(endpoint: string, label: string) {
    const evidence = localEndpointEvidence(status, endpoint, label);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied local endpoint evidence.");
    } catch (error) {
      console.error(error);
      showActionMessage(`Copy failed. Local endpoint evidence: ${evidence}`, true);
    }
  }

  async function copyAuditFingerprint(label: string, fingerprint: string | null) {
    if (!fingerprint) {
      showActionMessage(`${label} full fingerprint unavailable.`, true);
      return;
    }

    try {
      await navigator.clipboard.writeText(fingerprint);
      showActionMessage(`Copied ${label} full fingerprint.`);
    } catch {
      showActionMessage(`Copy failed. ${label} full fingerprint: ${fingerprint}`, true);
    }
  }

  async function copyFingerprint(device: Device) {
    if (!device.publicKeyFingerprint) {
      showActionMessage(`Full fingerprint unavailable for ${device.name}.`, true);
      return;
    }

    try {
      await navigator.clipboard.writeText(device.publicKeyFingerprint);
      showActionMessage(`Copied full fingerprint for ${device.name}.`);
    } catch {
      showActionMessage(`Copy failed. Full fingerprint for ${device.name}: ${device.publicKeyFingerprint}`, true);
    }
  }

  async function copyStartupHealthEvidence() {
    const evidence = startupHealthEvidence(status);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied startup health evidence.");
    } catch {
      showActionMessage(`Copy failed. Startup health evidence: ${evidence}`, true);
    }
  }

  async function copyInputEventEvidence(event: InputEventRecord) {
    const evidence = inputEventEvidence(event, status.devices);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied input transport evidence.");
    } catch {
      showActionMessage(`Copy failed. Input transport evidence: ${evidence}`, true);
    }
  }

  async function copyCaptureEvidence() {
    const evidence = captureEvidence(status, captureTarget?.name);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied capture evidence.");
    } catch {
      showActionMessage(`Copy failed. Capture evidence: ${evidence}`, true);
    }
  }

  async function copyReceiveControlEvidence(device: Device) {
    const evidence = receiveControlEvidence(status, device);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied receive evidence.");
    } catch {
      showActionMessage(`Copy failed. Receive evidence: ${evidence}`, true);
    }
  }

  async function copyReconnectEvidence(device: Device) {
    const evidence = reconnectEvidence(status, device);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied reconnect evidence.");
    } catch (error) {
      console.error(error);
      showActionMessage(`Copy failed. Reconnect evidence: ${evidence}`, true);
    }
  }

  async function copySetupChecklistEvidence() {
    const evidence = setupChecklistEvidence(status, setupSteps);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied setup evidence.");
    } catch {
      showActionMessage(`Copy failed. Setup evidence: ${evidence}`, true);
    }
  }

  async function copyPairingEvidence(pairing: PendingPairing, enteredCode: string) {
    const evidence = pairingEvidence(pairing, enteredCode, pairingNowMs);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied pairing evidence.");
    } catch {
      showActionMessage(`Copy failed. Pairing evidence: ${evidence}`, true);
    }
  }

  async function copyTrustedEndpointUpdateEvidence(device: Device) {
    const evidence = trustedEndpointUpdateEvidence(device, manualEndpoint);
    try {
      await navigator.clipboard.writeText(evidence);
      showActionMessage("Copied trusted IP evidence.");
    } catch {
      showActionMessage(`Copy failed. Trusted IP evidence: ${evidence}`, true);
    }
  }

  async function pairDevice(device: Device) {
    await runExclusiveAction(`pair:${device.id}`, async () => {
      const action = await invokeNetworkAction("initiate_pairing", {
        request: pairRequestForDevice(device)
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function confirmPairing(pairing: PendingPairing) {
    if (actionIsActive(`confirm-pairing:${pairing.id}`)) return;
    const enteredCode = pairingCodeEntries[pairing.id]?.trim() ?? "";
    if (pairingNowMs >= pairing.expiresAtMs) {
      showActionMessage("Pairing request expired. Start pairing again.", true);
      await refreshStatus();
      return;
    }

    if (!/^\d{6}$/.test(enteredCode)) {
      showActionMessage("Enter the six-digit code from the other computer before confirming.", true);
      return;
    }

    await runExclusiveAction(`confirm-pairing:${pairing.id}`, async () => {
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
    });
  }

  async function cancelPairing(pairing: PendingPairing) {
    await runExclusiveAction(`cancel-pairing:${pairing.id}`, async () => {
      const action = await invokeNetworkAction("cancel_pairing", {
        request: { pairingId: pairing.id }
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function updateSetting(
    key: "role" | "autoStart" | "trustedReconnect" | "privateNetworkOnly" | "allowIncomingControl",
    value: boolean | ComputerRole
  ) {
    await runExclusiveAction(`setting:${key}`, async () => {
      const action = await invokeNetworkAction("update_settings", {
        request: { [key]: value }
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function updateDeviceControl(device: Device, value: boolean) {
    await runExclusiveAction(`receive:${device.id}`, async () => {
      const action = await invokeNetworkAction("update_device_control", {
        request: { deviceId: device.id, allowIncomingControl: value }
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function enableReceiveForTrustedDevices() {
    await runExclusiveAction("receive-shortcut", async () => {
      const action = await invokeNetworkAction("enable_receive_for_trusted_devices");
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function forgetTrustedDevice(device: Device) {
    await runExclusiveAction(`forget:${device.id}`, async () => {
      const confirmed = window.confirm(`Forget trusted device "${device.name}"?`);
      if (!confirmed) return;

      const action = await invokeNetworkAction("forget_trusted_device", {
        request: { deviceId: device.id }
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function requestInputPermissions() {
    await runExclusiveAction("request-input-permissions", async () => {
      try {
        const nextPermissions = await invoke<InputPermissionStatus>("request_input_permissions");
        setPermissions(nextPermissions);
        showActionMessage("Input permission request sent.");
        await refreshStatus(false);
      } catch (error) {
        showActionMessage(`Input permission request failed: ${commandErrorMessage(error)}`, true);
        await refreshStatus(false);
      }
    });
  }

  async function sendTestInput(device: Device) {
    if (actionIsActive(`test:${device.id}`)) return;
    if (!canSendInput(status.mode)) {
      showActionMessage("Set this computer role to Main or Both before sending test input.", true);
      return;
    }

    await runExclusiveAction(`test:${device.id}`, async () => {
      const action = await invokeNetworkAction("send_test_input", {
        request: { deviceId: device.id }
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function checkTrustedDevice(device: Device) {
    if (actionIsActive(`check:${device.id}`)) return;
    if (!status.trustedReconnect) {
      showActionMessage("Turn on Auto reconnect before running trusted checks.", true);
      return;
    }

    await runExclusiveAction(`check:${device.id}`, async () => {
      const action = await invokeNetworkAction("check_trusted_device", {
        request: { deviceId: device.id }
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function checkAllTrustedDevices() {
    if (checkingTrustedDevices) return;
    if (!status.trustedReconnect) {
      showActionMessage("Turn on Auto reconnect before checking trusted devices.", true);
      return;
    }
    if (checkableTrustedDevices.length === 0) {
      showActionMessage("No trusted devices have a known endpoint for reconnect checks.", true);
      return;
    }

    setCheckingTrustedDevices(true);
    try {
      let reachableCount = 0;
      let lastFailure: { deviceName: string; endpointSource: string; message: string } | null = null;
      for (const device of checkableTrustedDevices) {
        const action = await invokeNetworkAction("check_trusted_device", {
          request: { deviceId: device.id }
        });
        if (action.ok) {
          reachableCount += 1;
        } else {
          lastFailure = {
            deviceName: device.name,
            endpointSource: endpointSourceLabel(device),
            message: action.message
          };
        }
      }

      showActionMessage(
        lastFailure
          ? `Checked ${checkableTrustedDevices.length}; ${reachableCount} reachable. Last failure: ${lastFailure.deviceName} via ${lastFailure.endpointSource}: ${lastFailure.message}`
          : `Checked ${reachableCount} trusted device${reachableCount === 1 ? "" : "s"}.`,
        Boolean(lastFailure)
      );
      await refreshStatus();
    } finally {
      setCheckingTrustedDevices(false);
    }
  }

  async function startCapture(device: Device) {
    if (actionIsActive(`capture:${device.id}`)) return;
    if (!canSendInput(status.mode)) {
      showActionMessage("Set this computer role to Main or Both before starting capture.", true);
      return;
    }

    await runExclusiveAction(`capture:${device.id}`, async () => {
      const action = await invokeNetworkAction("start_capture", {
        request: { deviceId: device.id }
      });
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
  }

  async function stopCapture() {
    await runExclusiveAction("stop-capture", async () => {
      const action = await invokeNetworkAction("stop_capture");
      showActionMessage(action.message, !action.ok);
      await refreshStatus();
    });
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
  const receiveShortcutButtonLabel = receiveShortcutLabel(
    status.allowIncomingControl,
    trustedDevicesNeedingReceive.length
  );
  const scanLanActive = actionIsActive("scan-lan");
  const manualConnectActive = actionIsActive("manual-connect");
  const clearManualEndpointActive = actionIsActive("clear-manual-endpoint");
  const requestInputPermissionsActive = actionIsActive("request-input-permissions");
  const refreshStatusActive = actionIsActive("refresh-status");
  const manualFormActive = loading || manualConnectActive || clearManualEndpointActive;
  const checkableTrustedDevices = useMemo(
    () => trustedDevices.filter((device) => device.endpoint && device.inputControlReady),
    [trustedDevices]
  );
  const endpointUpdateDevice = useMemo(
    () => trustedDevices.find((device) => device.id === endpointUpdateDeviceId) ?? null,
    [endpointUpdateDeviceId, trustedDevices]
  );
  useEffect(() => {
    if (!endpointUpdateDeviceId || endpointUpdateDevice) return;
    restoreManualPairAfterTrustedUpdate(
      "Trusted IP update target is no longer available. Manual pair field kept."
    );
  }, [endpointUpdateDevice, endpointUpdateDeviceId, manualEndpoint, status.discovery.manualEndpoint]);
  useEffect(() => {
    if (!endpointUpdateDeviceId || !endpointUpdateDevice) return;
    if (!endpointUpdateDevice.inputControlReady) {
      restoreManualPairAfterTrustedUpdate(
        "Trusted IP update target needs re-pairing. Manual pair field kept for re-pairing."
      );
    }
  }, [
    endpointUpdateDevice,
    endpointUpdateDeviceId,
    manualEndpoint,
    status.discovery.manualEndpoint
  ]);
  const reconnectChecksAvailable =
    status.trustedReconnect && checkableTrustedDevices.length > 0;
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
  const staleTrustedDevicesNeedingRepair = useMemo(
    () => trustedDevices.filter((device) => !device.inputControlReady && !device.endpoint),
    [trustedDevices]
  );
  const failedTrustedDevices = useMemo(
    () => trustedDevices.filter((device) => device.lastConnectionFailure),
    [trustedDevices]
  );
  const mostRecentFailedTrustedDevice = useMemo(
    () => mostRecentConnectionFailure(failedTrustedDevices),
    [failedTrustedDevices]
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

    if (mostRecentFailedTrustedDevice) {
      return {
        state: "Reconnect recovery",
        detail:
          connectionFailureHint(mostRecentFailedTrustedDevice) ??
          mostRecentFailedTrustedDevice.lastConnectionFailure?.message ??
          "Use the visible failure reason before retrying."
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

    if (staleTrustedDevicesNeedingRepair.length > 0) {
      return {
        state: "Manual re-pair needed",
        detail: `${plural(staleTrustedDevicesNeedingRepair.length, "trusted computer")} needs Pair manually with a copied endpoint.`
      };
    }

    return {
      state: "No active path",
      detail: "Waiting for LAN discovery or a manual endpoint."
    };
  }, [
    discoveredDevices.length,
    mostRecentFailedTrustedDevice,
    savedEndpointDevices.length,
    status.discovery.discoveryPort,
    status.discovery.manualEndpoint,
    staleTrustedDevicesNeedingRepair.length,
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
  const setupSteps = useMemo<SetupStep[]>(
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
          <div className="setup-checklist-heading">
            <span>{"Mac main -> Windows client"}</span>
            <button
              className="setup-evidence-copy"
              onClick={copySetupChecklistEvidence}
              title="Copy setup evidence"
              type="button"
            >
              <Copy size={12} />
              <span>Copy</span>
            </button>
          </div>
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
          <button
            className="icon-button"
            disabled={loading || refreshStatusActive}
            onClick={refreshDeviceStatus}
            aria-label="Refresh devices"
            title={refreshStatusActive ? "Refreshing devices." : "Refresh devices"}
            type="button"
          >
            <RefreshCw size={18} className={loading || refreshStatusActive ? "spin" : ""} />
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
              title={reconnectCheckTitle(status.trustedReconnect, checkableTrustedDevices.length)}
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
                    : checkableTrustedDevices.length > 0
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
            {status.capture.active && (
              <button
                className="metric-evidence-copy"
                onClick={copyCaptureEvidence}
                title="Copy capture evidence"
                type="button"
              >
                <Copy size={13} />
                <span>Copy</span>
              </button>
            )}
            {receiveShortcutAvailable && (
              <button
                className="secondary-button compact"
                disabled={actionIsActive("receive-shortcut")}
                onClick={enableReceiveForTrustedDevices}
                title={
                  status.allowIncomingControl
                    ? "Enable Receive for trusted devices with a shared input secret."
                    : "Enable global incoming control and trusted-device Receive toggles."
                }
                type="button"
              >
                {actionIsActive("receive-shortcut") ? "Enabling" : receiveShortcutButtonLabel}
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
              disabled={requestInputPermissionsActive}
              onClick={requestInputPermissions}
              type="button"
            >
              {requestInputPermissionsActive ? "Requesting" : "Request"}
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
                  {localEndpoints.map((endpoint, index) => {
                    const endpointLabel = localEndpointChoiceLabel(endpoint, index);
                    return (
                      <div className="endpoint-copy-row" key={endpoint}>
                        <button
                          className="endpoint-copy"
                          onClick={() => copyLocalEndpoint(endpoint, endpointLabel)}
                          type="button"
                          title={`Copy ${endpointLabel} endpoint ${endpoint}`}
                        >
                          <Copy size={13} />
                          <span className="endpoint-choice-label">
                            {copiedEndpoint === endpoint ? "Copied" : endpointLabel}
                          </span>
                          <code>{endpoint}</code>
                        </button>
                        <button
                          className="endpoint-evidence-copy"
                          onClick={() => copyLocalEndpointEvidence(endpoint, endpointLabel)}
                          type="button"
                          title="Copy local endpoint evidence"
                        >
                          <Copy size={12} />
                          <span>Evidence</span>
                        </button>
                      </div>
                    );
                  })}
                  <small className="endpoint-hint">
                    Prefer Best LAN IPv4 on the same Wi-Fi/LAN subnet; use LAN IPv6 only when both computers support IPv6.
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
                {reconnectHealthDetail(mostRecentFailedTrustedDevice, checkableTrustedDevices.length)}
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
            <button
              className="startup-health-copy"
              onClick={copyStartupHealthEvidence}
              title="Copy startup health evidence"
              type="button"
            >
              <Copy size={13} />
              <span>Copy</span>
            </button>
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
            disabled={requestInputPermissionsActive}
            onClick={requestInputPermissions}
            type="button"
          >
            {requestInputPermissionsActive ? "Requesting" : "Request"}
          </button>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Nearby Computers</h3>
              <p>Pair once with approval on both computers, then reconnect after restart, wake, or Wi-Fi changes.</p>
            </div>
            <button className="primary-button" onClick={scanLan} disabled={loading || scanLanActive}>
              {scanLanActive ? "Scanning" : "Scan LAN"}
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
            {status.devices.map((device) => {
              const pairActive = actionIsActive(`pair:${device.id}`);
              const checkActive = actionIsActive(`check:${device.id}`);
              const testActive = actionIsActive(`test:${device.id}`);
              const captureActive = actionIsActive(`capture:${device.id}`);
              const receiveActive = actionIsActive(`receive:${device.id}`);
              const forgetActive = actionIsActive(`forget:${device.id}`);
              const deviceActionActive =
                pairActive || checkActive || testActive || captureActive || receiveActive || forgetActive;

              return (
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
                  <button
                    className="secondary-button compact"
                    disabled={deviceActionActive}
                    onClick={() => pairDevice(device)}
                  >
                    {pairActive ? "Pairing" : "Pair"}
                  </button>
                )}
                {device.trusted && device.endpoint && !device.inputControlReady && (
                  <button
                    className="secondary-button compact"
                    disabled={deviceActionActive}
                    onClick={() => pairDevice(device)}
                  >
                    {pairActive ? "Pairing" : "Re-pair"}
                  </button>
                )}
                {device.trusted && !device.endpoint && !device.inputControlReady && (
                  <button
                    className="secondary-button compact"
                    disabled={deviceActionActive}
                    onClick={() => prepareManualRepair(device)}
                    title="Paste this trusted device's current endpoint into Manual pair to re-pair it."
                    type="button"
                  >
                    Pair manually
                  </button>
                )}
                {device.trusted && device.endpoint && device.inputControlReady && (
                  <button
                    className="secondary-button compact"
                    disabled={checkingTrustedDevices || !status.trustedReconnect || deviceActionActive}
                    onClick={() => checkTrustedDevice(device)}
                    title={
                      status.trustedReconnect
                        ? "Run an authenticated reconnect check for this device."
                        : "Turn on Auto reconnect to run trusted checks."
                    }
                  >
                    {checkActive ? "Checking" : "Check"}
                  </button>
                )}
                {device.trusted && (
                  <button
                    className="reconnect-evidence-copy"
                    onClick={() => copyReconnectEvidence(device)}
                    title="Copy reconnect evidence"
                    type="button"
                  >
                    <Copy size={12} />
                    <span>Copy</span>
                  </button>
                )}
                {canEditTrustedEndpoint(device) && (
                  <button
                    className="secondary-button compact"
                    disabled={deviceActionActive}
                    onClick={() => editManualEndpoint(device)}
                    title="Verify a new endpoint for this trusted device without pairing again."
                  >
                    {device.endpoint ? "Edit IP" : "Set IP"}
                  </button>
                )}
                {device.trusted && device.endpoint && device.inputControlReady && (
                  <button
                    className="secondary-button compact"
                    disabled={!sendRoleReady || deviceActionActive}
                    onClick={() => sendTestInput(device)}
                    title={
                      sendRoleReady
                        ? "Send a trusted test input event to this device."
                        : "Set this computer role to Main or Both before sending input."
                    }
                  >
                    {testActive ? "Testing" : "Test"}
                  </button>
                )}
                {device.trusted && device.endpoint && device.inputControlReady && (
                  status.capture.active && status.capture.targetDeviceId === device.id ? (
                    <button
                      className="secondary-button compact"
                      disabled={actionIsActive("stop-capture")}
                      onClick={stopCapture}
                    >
                      {actionIsActive("stop-capture") ? "Stopping" : "Stop"}
                    </button>
                  ) : (
                    <button
                      className="secondary-button compact"
                      disabled={status.capture.active || !captureReady || !sendRoleReady || deviceActionActive}
                      onClick={() => startCapture(device)}
                      title={captureButtonTitle(captureReady, status.capture.active, status.mode)}
                    >
                      {captureActive ? "Starting" : "Capture"}
                    </button>
                  )
                )}
                {device.trusted && (
                  <button
                    className="secondary-button compact"
                    disabled={deviceActionActive}
                    onClick={() => forgetTrustedDevice(device)}
                  >
                    {forgetActive ? "Forgetting" : "Forget"}
                  </button>
                )}
                {device.trusted && (
                  <>
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
                        disabled={!device.inputControlReady || !receiveRoleReady || deviceActionActive}
                        onChange={(event) => updateDeviceControl(device, event.target.checked)}
                      />
                      {!device.inputControlReady && <em>Re-pair</em>}
                    </label>
                    <button
                      className="receive-evidence-copy"
                      onClick={() => copyReceiveControlEvidence(device)}
                      title="Copy receive evidence"
                      type="button"
                    >
                      <Copy size={12} />
                      <span>Copy</span>
                    </button>
                  </>
                )}
              </article>
              );
            })}
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
              {status.recentInputEvents.map((event, index) => {
                const deviceLabel = inputEventDeviceLabel(event, status.devices);
                const detailLabel = inputEventDetailLabel(event);
                return (
                  <div
                    className={`event-row ${event.accepted ? "event-row-success" : "event-row-failed"}`}
                    key={`${event.atMs}-${event.deviceId}-${event.direction}-${event.summary}-${index}`}
                  >
                    <Keyboard size={16} />
                    <span>{inputEventDirectionLabel(event)}</span>
                    <div className="event-copy">
                      <strong>{event.summary}</strong>
                      {detailLabel && <span className="event-detail">{detailLabel}</span>}
                    </div>
                    <small>
                      {deviceLabel} · {elapsedLabel(event.atMs)}
                    </small>
                    <em>{inputEventStatusLabel(event)}</em>
                    <button
                      className="event-evidence-copy"
                      onClick={() => copyInputEventEvidence(event)}
                      title="Copy input transport evidence"
                      type="button"
                    >
                      <Copy size={12} />
                      <span>Copy</span>
                    </button>
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
                const entryState = pairingCodeEntryState(pairing, enteredCode, pairingNowMs);
                const pairingExpired = pairingNowMs >= pairing.expiresAtMs;
                const confirmActive = actionIsActive(`confirm-pairing:${pairing.id}`);
                const cancelActive = actionIsActive(`cancel-pairing:${pairing.id}`);
                const pairingActionActive = confirmActive || cancelActive;

                return (
                  <article className="pairing-row" key={pairing.id}>
                    <div>
                      <h4>{pairing.name}</h4>
                      <p>
                        {pairing.platform} · {roleLabel(pairing.role)} · {pairing.endpoint} ·{" "}
                        {pairingDirectionLabel(pairing)} · {pairingExpiryLabel(pairing, pairingNowMs)}
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
                    <button
                      className="pairing-evidence-copy"
                      onClick={() => copyPairingEvidence(pairing, enteredCode)}
                      title="Copy pairing evidence"
                      type="button"
                    >
                      <Copy size={12} />
                      <span>Copy</span>
                    </button>
                    <label className="pairing-code-entry">
                      <input
                        className={`pairing-code-input ${entryState.error ? "input-error" : ""}`}
                        inputMode="numeric"
                        maxLength={6}
                        pattern="[0-9]{6}"
                        placeholder="Other code"
                        value={enteredCode}
                        disabled={pairing.localApproved || pairingExpired || pairingActionActive}
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
                      disabled={!entryState.canConfirm || pairingActionActive}
                      onClick={() => confirmPairing(pairing)}
                    >
                      {confirmActive ? "Confirming" : pairing.localApproved ? "Waiting" : "Confirm"}
                    </button>
                    <button
                      className="secondary-button compact"
                      disabled={pairingActionActive}
                      onClick={() => cancelPairing(pairing)}
                    >
                      {cancelActive ? "Canceling" : "Cancel"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="connect-panel">
          <button className="secondary-button" onClick={scanLan} disabled={loading || scanLanActive}>
            <Wifi size={17} />
            {scanLanActive ? "Scanning" : "Scan LAN"}
          </button>
          <form onSubmit={submitManualConnect} className="manual-form">
            <label htmlFor="manual-endpoint">
              {endpointUpdateDevice
                ? `Update trusted IP for ${endpointUpdateDevice.name}`
                : "Manual pair"}
            </label>
            <div className="manual-endpoint-field">
              <input
                id="manual-endpoint"
                aria-describedby="manual-endpoint-hint"
                placeholder="host, host:port, IPv4, IPv6, or [IPv6]"
                value={manualEndpoint}
                disabled={manualFormActive}
                onChange={(event) => {
                  setManualEndpoint(event.target.value);
                  setManualEndpointDirty(true);
                }}
              />
              <small id="manual-endpoint-hint">
                {endpointUpdateDevice
                  ? "Copy the current endpoint from the other computer. Verify IP checks this trusted device without re-pairing."
                  : "Missing ports use 44777. Localhost, loopback, unspecified, and link-local IPv6 endpoints are rejected. Public IP literals are blocked while Private network only is on."}
              </small>
            </div>
            <button
              className="secondary-button"
              type="submit"
              disabled={manualFormActive || !manualEndpoint.trim()}
            >
              <Link size={17} />
              {manualConnectActive
                ? endpointUpdateDeviceId
                  ? "Verifying"
                  : "Connecting"
                : endpointUpdateDeviceId
                  ? "Verify IP"
                  : "Connect"}
            </button>
            {endpointUpdateDeviceId && (
              <button
                className="secondary-button"
                type="button"
                disabled={manualFormActive}
                onClick={cancelTrustedEndpointUpdate}
              >
                Cancel
              </button>
            )}
            {endpointUpdateDevice && (
              <button
                className="manual-evidence-copy"
                type="button"
                disabled={manualFormActive}
                onClick={() => copyTrustedEndpointUpdateEvidence(endpointUpdateDevice)}
                title="Copy trusted IP evidence"
              >
                <Copy size={12} />
                <span>Copy</span>
              </button>
            )}
            {status.discovery.manualEndpoint && !endpointUpdateDeviceId && (
              <button
                className="secondary-button compact"
                onClick={clearManualEndpoint}
                type="button"
                disabled={manualFormActive}
              >
                {clearManualEndpointActive ? "Clearing" : "Clear"}
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
              disabled={actionIsActive("setting:role")}
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
              disabled={actionIsActive("setting:autoStart")}
              onChange={(event) => updateSetting("autoStart", event.target.checked)}
            />
          </label>
          <label>
            <span>Reconnect trusted devices</span>
            <input
              type="checkbox"
              checked={status.trustedReconnect}
              disabled={actionIsActive("setting:trustedReconnect")}
              onChange={(event) => updateSetting("trustedReconnect", event.target.checked)}
            />
          </label>
          <label>
            <span>Private network only</span>
            <input
              type="checkbox"
              checked={status.privateNetworkOnly}
              disabled={actionIsActive("setting:privateNetworkOnly")}
              onChange={(event) => updateSetting("privateNetworkOnly", event.target.checked)}
            />
          </label>
          <label>
            <span>Allow incoming control</span>
            <input
              type="checkbox"
              checked={status.allowIncomingControl}
              disabled={!receiveRoleReady || actionIsActive("setting:allowIncomingControl")}
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
