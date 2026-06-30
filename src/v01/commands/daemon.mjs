import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir, pathExists, removeFile, writeText } from "../lib/fs.mjs";
import { defaultConfigPath, expandHome, homeDir, logPath, pidPath, repoRoot } from "../lib/paths.mjs";
import { runCommand } from "../lib/commands.mjs";

export async function runDaemon(args) {
  const action = args._[1] || "status";
  if (action === "start") return startDaemon(args);
  if (action === "stop") return stopDaemon();
  if (action === "restart") {
    await stopDaemon({ quiet: true });
    return startDaemon(args);
  }
  if (action === "status") return statusDaemon();
  if (action === "logs") return showLogs(args);
  if (action === "install") return installDaemon(args);
  if (action === "uninstall") return uninstallDaemon();
  throw new Error(`Unknown daemon action: ${action}`);
}

async function startDaemon(args) {
  const existing = await readPid();
  if (existing && isRunning(existing)) {
    console.log(`OpenTag daemon is already running: pid ${existing}`);
    return;
  }

  await ensureDir(homeDir());
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  const out = openSync(logPath(), "a");
  writeSync(out, `\n--- opentag daemon start ${new Date().toISOString()} ---\n`);
  const child = spawn(process.execPath, [path.join(repoRoot(), "bin", "opentag.js"), "start", "--config", configPath], {
    cwd: repoRoot(),
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, OPENTAG_CONFIG: configPath }
  });
  closeSync(out);
  child.unref();
  await writeText(pidPath(), `${child.pid}\n`);
  const startup = await waitForStartup(child.pid, child, 1200);
  if (!startup.ok) {
    await removeFile(pidPath());
    const tail = await readLogTail(30);
    throw new Error([
      `OpenTag daemon failed to start: ${startup.reason}`,
      `Logs: ${logPath()}`,
      tail ? `Recent log:\n${tail}` : null
    ].filter(Boolean).join("\n"));
  }
  console.log(`OpenTag daemon started: pid ${child.pid}`);
  console.log(`Logs: ${logPath()}`);
}

async function stopDaemon(options = {}) {
  const pid = await readPid();
  if (!pid) {
    if (!options.quiet) console.log("OpenTag daemon is not running.");
    return;
  }
  if (isRunning(pid)) {
    process.kill(pid, "SIGTERM");
    await waitForExit(pid, 3000);
  }
  await removeFile(pidPath());
  if (!options.quiet) console.log("OpenTag daemon stopped.");
}

async function statusDaemon() {
  const pid = await readPid();
  if (pid && isRunning(pid)) {
    console.log(`OpenTag daemon is running: pid ${pid}`);
    return;
  }
  console.log("OpenTag daemon is stopped.");
}

async function showLogs(args) {
  if (!(await pathExists(logPath()))) {
    console.log(`No daemon log yet: ${logPath()}`);
    return;
  }
  const lines = Number(args.lines || args.n || 120);
  const content = await readFile(logPath(), "utf8");
  console.log(content.split(/\r?\n/).slice(-lines).join("\n"));
}

async function installDaemon(args) {
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  if (process.platform === "darwin") return installLaunchd(configPath);
  if (process.platform === "linux") return installSystemd(configPath);
  throw new Error("daemon install currently supports macOS launchd and Linux systemd user services.");
}

async function uninstallDaemon() {
  if (process.platform === "darwin") {
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", "com.opentag.daemon.plist");
    await runCommand("launchctl", ["unload", plist]);
    await removeFile(plist);
    console.log(`Removed ${plist}`);
    return;
  }
  if (process.platform === "linux") {
    const service = path.join(os.homedir(), ".config", "systemd", "user", "opentag.service");
    await runCommand("systemctl", ["--user", "disable", "--now", "opentag.service"]);
    await removeFile(service);
    await runCommand("systemctl", ["--user", "daemon-reload"]);
    console.log(`Removed ${service}`);
    return;
  }
  throw new Error("daemon uninstall currently supports macOS and Linux.");
}

async function installLaunchd(configPath) {
  const plist = path.join(os.homedir(), "Library", "LaunchAgents", "com.opentag.daemon.plist");
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.opentag.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(repoRoot(), "bin", "opentag.js")}</string>
    <string>start</string>
    <string>--config</string>
    <string>${configPath}</string>
  </array>
  <key>WorkingDirectory</key><string>${repoRoot()}</string>
  <key>StandardOutPath</key><string>${logPath()}</string>
  <key>StandardErrorPath</key><string>${logPath()}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`;
  await writeText(plist, content);
  console.log(`Installed launchd service: ${plist}`);
  console.log("Run: launchctl load ~/Library/LaunchAgents/com.opentag.daemon.plist");
}

async function installSystemd(configPath) {
  const service = path.join(os.homedir(), ".config", "systemd", "user", "opentag.service");
  const content = `[Unit]
Description=OpenTag local daemon

[Service]
WorkingDirectory=${repoRoot()}
ExecStart=${process.execPath} ${path.join(repoRoot(), "bin", "opentag.js")} start --config ${configPath}
Restart=always
RestartSec=3
StandardOutput=append:${logPath()}
StandardError=append:${logPath()}

[Install]
WantedBy=default.target
`;
  await writeText(service, content);
  await runCommand("systemctl", ["--user", "daemon-reload"]);
  console.log(`Installed systemd user service: ${service}`);
  console.log("Run: systemctl --user enable --now opentag.service");
}

async function readPid() {
  if (!(await pathExists(pidPath()))) return null;
  const value = Number((await readFile(pidPath(), "utf8")).trim());
  return Number.isFinite(value) ? value : null;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForStartup(pid, child, timeoutMs) {
  let exit = null;
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  if (exit) return { ok: false, reason: `process exited with code=${exit.code} signal=${exit.signal || "none"}` };
  if (!isRunning(pid)) return { ok: false, reason: "process is not running" };
  return { ok: true };
}

async function readLogTail(lines) {
  if (!(await pathExists(logPath()))) return "";
  const content = await readFile(logPath(), "utf8").catch(() => "");
  return content.split(/\r?\n/).slice(-lines).join("\n").trim();
}
