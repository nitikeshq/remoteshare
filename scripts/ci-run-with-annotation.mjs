import { spawnSync } from "node:child_process";
import fs from "node:fs";

const [label, command, ...args] = process.argv.slice(2);

if (!label || !command) {
  throw new Error("Usage: node scripts/ci-run-with-annotation.mjs <label> <command> [args...]");
}

const result = spawnSync(command, args, {
  encoding: "utf8",
  shell: process.platform === "win32"
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.error) {
  fail(`${label} could not start: ${result.error.message}`);
}

if (result.status !== 0) {
  fail(`${label} failed with exit ${result.status}.\n${tail(output)}`);
}

function fail(message) {
  const clean = message.trim();
  writeSummary(clean);
  console.error(`::error title=${escapeCommand(label)}::${escapeCommand(clean)}`);
  process.exit(result.status || 1);
}

function tail(output) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-80).join("\n");
}

function writeSummary(message) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  fs.appendFileSync(
    summaryPath,
    [
      `## ${label}`,
      "",
      "```text",
      message,
      "```",
      ""
    ].join("\n")
  );
}

function escapeCommand(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A");
}
