import { readFile } from "node:fs/promises";
import { pathExists } from "./fs.mjs";
import { envPath } from "./paths.mjs";

export async function loadLocalEnv(filePath = envPath()) {
  if (!(await pathExists(filePath))) return { loaded: false, path: filePath, keys: [] };
  const content = await readFile(filePath, "utf8");
  const keys = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
    keys.push(key);
  }
  return { loaded: true, path: filePath, keys };
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const commentIndex = trimmed.search(/\s+#/);
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trim();
}
