import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-ui-endpoint-labels-"));
const tsc = path.join(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.cmd" : "tsc"
);

try {
  const result = spawnSync(
    tsc,
    [
      "src/endpoint-labels.ts",
      "--target",
      "ES2020",
      "--module",
      "ES2020",
      "--moduleResolution",
      "Node",
      "--strict",
      "--skipLibCheck",
      "--outDir",
      root
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to compile endpoint label helpers.\n${result.stdout}\n${result.stderr}`);
  }

  const labels = await import(pathToFileURL(path.join(root, "endpoint-labels.js")).href);
  assert.equal(labels.localEndpointChoiceLabel("192.168.1.20:44777", 0), "Best LAN IPv4");
  assert.equal(labels.localEndpointChoiceLabel("192.168.1.21:44777", 1), "LAN IPv4");
  assert.equal(labels.localEndpointChoiceLabel("[fd12:3456:789a::10]:44777", 2), "LAN IPv6");
  assert.equal(labels.localEndpointChoiceLabel("[FD12:3456:789A::10]:44777", 2), "LAN IPv6");
  assert.equal(labels.localEndpointChoiceLabel("fd12:3456:789a::10", 2), "LAN IPv6");
  assert.equal(labels.localEndpointChoiceLabel("FD12:3456:789A::10", 2), "LAN IPv6");
  assert.equal(labels.localEndpointChoiceLabel("[2001:db8::20]:44777", 3), "IPv6 fallback");
  assert.equal(labels.localEndpointChoiceLabel("2001:db8::20", 3), "IPv6 fallback");
  assert.equal(labels.localEndpointChoiceLabel("203.0.113.20:44777", 4), "Fallback IPv4");
  assert.equal(labels.localEndpointManualFallbackLabel("192.168.1.20:44777", 0), "preferred LAN IPv4");
  assert.equal(labels.localEndpointManualFallbackLabel("192.168.1.21:44777", 1), "LAN IPv4");
  assert.equal(labels.localEndpointManualFallbackLabel("[fd12:3456:789a::10]:44777", 2), "LAN IPv6");
  assert.equal(labels.localEndpointManualFallbackLabel("[2001:db8::20]:44777", 3), "not first-MVP preferred");
  assert.equal(labels.localEndpointManualFallbackLabel("203.0.113.20:44777", 4), "not first-MVP preferred");
  assert.deepEqual(labels.validateManualEndpoint("192.168.1.20", true), {
    ok: true,
    message: "Ready; missing port will use 44777."
  });
  assert.deepEqual(labels.validateManualEndpoint("192.168.1.20:44777", true), {
    ok: true,
    message: "Ready to use port 44777."
  });
  assert.deepEqual(labels.validateManualEndpoint("[fd12:3456:789a::10]:44777", true), {
    ok: true,
    message: "Ready to use port 44777."
  });
  assert.equal(labels.validateManualEndpoint("203.0.113.20:44777", true).ok, false);
  assert.equal(labels.validateManualEndpoint("https://192.168.1.20:44777", true).ok, false);
  assert.equal(labels.validateManualEndpoint("192.168.1.20:70000", true).ok, false);
  assert.equal(labels.validateManualEndpoint("127.0.0.1:44777", true).ok, false);
  assert.equal(labels.validateManualEndpoint("fe80::1", true).ok, false);
  assert.equal(labels.validateManualEndpoint("windows-client.local", true).ok, true);

  const mainTsx = fs.readFileSync("src/main.tsx", "utf8");
  assert.match(mainTsx, /function roleCapabilityMessage\(/);
  assert.match(mainTsx, /permissions\.captureEngine === "ready"/);
  assert.match(
    mainTsx,
    /Windows Main capture is planned; use Client for the first Mac-to-Windows MVP\./
  );
  assert.match(mainTsx, /Main needs Mac Input Monitoring before Capture can start\./);
  assert.match(mainTsx, /roleCapability && <small>\{roleCapability\}<\/small>/);

  console.log("UI endpoint label tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
