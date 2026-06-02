import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "remoteshare-ci-annotation-"));
const helper = path.resolve("scripts/ci-run-with-annotation.mjs");

try {
  const okScript = writeScript("ok.mjs", "console.log('ok output');");
  runHelper("ok command", okScript, true, ["ok output"]);

  const failScript = writeScript(
    "fail.mjs",
    "console.error('compiler tail line'); process.exit(7);"
  );
  runHelper("failing command", failScript, false, [
    "::error title=failing command::",
    "compiler tail line"
  ]);

  console.log("CI annotation helper tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeScript(name, body) {
  const file = path.join(root, name);
  fs.writeFileSync(file, body);
  return file;
}

function runHelper(label, script, shouldPass, expectedOutput) {
  const result = spawnSync(process.execPath, [helper, label, process.execPath, script], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`${label}: expected success, got exit ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`${label}: expected failure, got success\n${output}`);
  }

  for (const expected of expectedOutput) {
    if (!output.includes(expected)) {
      throw new Error(`${label}: expected output to include ${expected}\n${output}`);
    }
  }
}
