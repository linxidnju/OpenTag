import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function homeDir() {
  return process.env.OPENTAG_HOME || path.join(os.homedir(), ".opentag");
}

export function defaultConfigPath() {
  return path.join(homeDir(), "config.json");
}

export function manifestPath() {
  return path.join(homeDir(), "slack-app-manifest.yml");
}

export function envPath() {
  return path.join(homeDir(), ".env");
}

export function envExamplePath() {
  return path.join(homeDir(), ".env.example");
}

export function projectsPath() {
  return path.join(homeDir(), "projects.json");
}

export function pidPath() {
  return path.join(homeDir(), "opentag.pid");
}

export function logPath() {
  return path.join(homeDir(), "opentag.log");
}

export function projectBindingPath(projectDir) {
  return path.join(projectDir, ".opentag", "project.json");
}

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function expandHome(value) {
  if (!value || typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
