import { spawnSync } from "node:child_process";

const command = process.env.REMOTESHARE_RUSTFMT_COMMAND ?? "rustfmt";
const args = process.env.REMOTESHARE_RUSTFMT_ARGS_JSON
  ? JSON.parse(process.env.REMOTESHARE_RUSTFMT_ARGS_JSON)
  : ["--version"];

if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
  throw new Error("REMOTESHARE_RUSTFMT_ARGS_JSON must be a JSON array of strings.");
}

const result = spawnSync(command, args, { encoding: "utf8" });

if (result.error) {
  throw new Error(formatFailure(`Rust formatter command is not available: ${result.error.message}`));
}

if (result.status !== 0) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  throw new Error(formatFailure(output || `rustfmt exited with status ${result.status}.`));
}

const version = (result.stdout || result.stderr || "rustfmt available").trim().split(/\r?\n/)[0];
console.log(`Rust formatter available: ${version}`);

function formatFailure(detail) {
  return [
    "Rust formatter is unavailable or broken.",
    detail,
    "Install or repair it with `rustup component add rustfmt`, or update the active toolchain with `rustup update stable`."
  ].join("\n");
}
