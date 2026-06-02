import { execFileSync } from "node:child_process";

const minMib = Number.parseInt(process.argv[2] ?? process.env.REMOTESHARE_MIN_FREE_MIB ?? "1024", 10);
const target = process.argv[3] ?? ".";

if (!Number.isFinite(minMib) || minMib < 0) {
  throw new Error("Minimum free space must be a non-negative MiB value.");
}

const availableMib = freeSpaceMib(target);
if (availableMib < minMib) {
  throw new Error(
    `Only ${availableMib} MiB free at ${target}; need at least ${minMib} MiB. Free disk space before running verification.`
  );
}

console.log(`Disk preflight passed: ${availableMib} MiB free at ${target}.`);

function freeSpaceMib(targetPath) {
  try {
    return posixFreeSpaceMib(targetPath);
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }

    return windowsFreeSpaceMib(targetPath);
  }
}

function posixFreeSpaceMib(targetPath) {
  const output = execFileSync("df", ["-Pk", targetPath], { encoding: "utf8" });
  const lines = output.trim().split(/\r?\n/);
  const dataLine = lines.at(-1);
  if (!dataLine) {
    throw new Error(`Unable to read disk free space for ${targetPath}.`);
  }

  const columns = dataLine.trim().split(/\s+/);
  const availableKib = Number.parseInt(columns[3], 10);
  if (!Number.isFinite(availableKib)) {
    throw new Error(`Unable to parse available disk space from df output: ${dataLine}`);
  }

  return Math.floor(availableKib / 1024);
}

function windowsFreeSpaceMib(targetPath) {
  const script = "$item = Get-Item -LiteralPath $args[0]; [math]::Floor($item.PSDrive.Free / 1MB)";
  const output = execWindowsShell(script, targetPath).trim();
  const availableMib = Number.parseInt(output, 10);
  if (!Number.isFinite(availableMib)) {
    throw new Error(`Unable to parse available disk space from PowerShell output: ${output}`);
  }

  return availableMib;
}

function execWindowsShell(script, targetPath) {
  const args = ["-NoProfile", "-Command", script, targetPath];
  try {
    return execFileSync("powershell", args, { encoding: "utf8" });
  } catch (error) {
    return execFileSync("pwsh", args, { encoding: "utf8" });
  }
}
