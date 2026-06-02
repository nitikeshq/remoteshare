import { spawnSync } from "node:child_process";
import path from "node:path";

const checker = path.resolve("scripts/check-disk-space.mjs");

runChecker(["0"], true, "Disk preflight passed");
runChecker(["999999999"], false, "Free disk space before running verification");
runChecker(["not-a-number"], false, "Minimum free space must be a non-negative MiB value");
runChecker([], true, "Disk preflight passed", { REMOTESHARE_MIN_FREE_MIB: "0" });

console.log("Disk preflight tests passed.");

function runChecker(args, shouldPass, expectedOutput, env = {}) {
  const result = spawnSync(process.execPath, [checker, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (shouldPass && result.status !== 0) {
    throw new Error(`expected disk preflight success, got ${result.status}\n${output}`);
  }

  if (!shouldPass && result.status === 0) {
    throw new Error(`expected disk preflight failure, got success\n${output}`);
  }

  if (!output.includes(expectedOutput)) {
    throw new Error(`expected output to include ${expectedOutput}\n${output}`);
  }
}
