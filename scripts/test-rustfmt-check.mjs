import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-rustfmt-check-"));
const checker = path.resolve("scripts/check-rustfmt.mjs");

try {
  const okScript = writeScript("ok.mjs", "console.log('rustfmt 1.0.0-test');");
  runChecker(okScript, true, "available", "Rust formatter available: rustfmt 1.0.0-test");

  const failScript = writeScript(
    "fail.mjs",
    "console.error('Library not loaded: librustc_driver-test.dylib'); process.exit(1);"
  );
  runChecker(failScript, false, "broken formatter", "Rust formatter is unavailable or broken.");
  runChecker(
    failScript,
    false,
    "broken formatter detail",
    "Library not loaded: librustc_driver-test.dylib"
  );

  const badArgs = spawnSync(process.execPath, [checker], {
    encoding: "utf8",
    env: {
      ...process.env,
      REMOTESHARE_RUSTFMT_COMMAND: process.execPath,
      REMOTESHARE_RUSTFMT_ARGS_JSON: "\"not-an-array\""
    }
  });
  if (badArgs.status === 0 || !`${badArgs.stdout}\n${badArgs.stderr}`.includes("JSON array of strings")) {
    throw new Error("invalid args json should fail with a helpful message");
  }

  console.log("Rust formatter check tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeScript(name, body) {
  const file = path.join(root, name);
  fs.writeFileSync(file, body);
  return file;
}

function runChecker(script, shouldPass, label, expectedOutput) {
  const result = spawnSync(process.execPath, [checker], {
    encoding: "utf8",
    env: {
      ...process.env,
      REMOTESHARE_RUSTFMT_COMMAND: process.execPath,
      REMOTESHARE_RUSTFMT_ARGS_JSON: JSON.stringify([script])
    }
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  if (!output.includes(expectedOutput)) {
    throw new Error(`${label}: expected output to include ${expectedOutput}\n${output}`);
  }
}
