import path from "node:path";
import { access, readdir, rm, stat, writeFile } from "node:fs/promises";
import { ensureDir } from "../utils/fs.js";
import { randomId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export class SandboxManager {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.rootDir = path.resolve(config.rootDir || "./.opentag/sandboxes");
  }

  async init() {
    await ensureDir(this.rootDir);
  }

  async createSandbox({ sessionId, runtimeId, channelConfig = {} }) {
    const runId = randomId("run");
    const dir = path.join(this.rootDir, safeName(sessionId), runId);
    await ensureDir(dir);
    const inputDir = path.join(dir, "inputs");
    const outputDir = path.join(dir, "outputs");
    await ensureDir(inputDir);
    await ensureDir(outputDir);
    const configuredRoot = channelConfig.workspaceRoot || channelConfig.cwd || this.config.workspaceRoot;
    const workspaceRoot = configuredRoot ? path.resolve(configuredRoot) : dir;
    if (configuredRoot) {
      await access(workspaceRoot);
      this.assertPathAllowed(workspaceRoot, channelConfig.allowedRoots || this.config.allowedRoots || [workspaceRoot], "workspaceRoot");
    } else {
      await ensureDir(workspaceRoot);
    }
    const sandbox = {
      id: runId,
      sessionId,
      runtimeId,
      dir,
      inputDir,
      outputDir,
      workspaceRoot,
      mode: this.config.mode || "ephemeral",
      createdAt: nowIso()
    };
    await writeFile(path.join(dir, "opentag-run.json"), `${JSON.stringify(sandbox, null, 2)}\n`, "utf8");
    return sandbox;
  }

  assertPathAllowed(targetPath, allowedRoots, label = "path") {
    const resolvedTarget = path.resolve(targetPath);
    const roots = Array.isArray(allowedRoots) && allowedRoots.length ? allowedRoots : [resolvedTarget];
    const ok = roots.some((root) => isSubpathOrEqual(resolvedTarget, path.resolve(root)));
    if (!ok) throw new Error(`${label} ${resolvedTarget} is outside allowed roots: ${roots.map((root) => path.resolve(root)).join(", ")}`);
    return true;
  }

  async collectArtifacts({ sandbox, sessionId, runtimeId }) {
    if (!this.config.collectArtifacts) return [];
    const maxBytes = Number(this.config.artifactMaxBytes || 5_000_000);
    const include = this.config.artifactInclude || ["*.md", "*.txt", "*.json", "*.patch", "*.diff", "*.log", "*.csv", "*.png", "*.jpg", "*.jpeg", "*.pdf", "*.html", "*.svg"];
    const files = await walkFiles(sandbox.dir, { maxDepth: 5, maxFiles: 200 });
    const artifacts = [];
    for (const filePath of files) {
      const relativePath = path.relative(sandbox.dir, filePath);
      if (relativePath === "opentag-run.json") continue;
      if (!matchesAny(relativePath, include)) continue;
      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile() || info.size > maxBytes) continue;
      artifacts.push({
        id: randomId("art"),
        sessionId,
        runId: sandbox.id,
        runtimeId,
        path: filePath,
        relativePath,
        size: info.size,
        createdAt: nowIso()
      });
    }
    return artifacts;
  }

  async cleanupSandbox(sandbox) {
    if (!this.config.cleanupOnComplete || !sandbox?.dir) return;
    const resolved = path.resolve(sandbox.dir);
    if (!resolved.startsWith(this.rootDir)) return;
    await rm(resolved, { recursive: true, force: true });
  }

  async cleanupOldSandboxes({ retentionHours } = {}) {
    const hours = Number(retentionHours || this.config.retentionHours || 24);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    let removed = 0;
    const sessionDirs = await readdir(this.rootDir).catch(() => []);
    for (const sessionDir of sessionDirs) {
      const fullSessionDir = path.join(this.rootDir, sessionDir);
      const info = await stat(fullSessionDir).catch(() => null);
      if (!info?.isDirectory()) continue;
      const runDirs = await readdir(fullSessionDir).catch(() => []);
      for (const runDir of runDirs) {
        const fullRunDir = path.join(fullSessionDir, runDir);
        const runInfo = await stat(fullRunDir).catch(() => null);
        if (!runInfo?.isDirectory()) continue;
        if (runInfo.mtimeMs < cutoff) {
          await rm(fullRunDir, { recursive: true, force: true });
          removed += 1;
        }
      }
    }
    return { removed };
  }
}

async function walkFiles(root, { maxDepth, maxFiles }, depth = 0, out = []) {
  if (out.length >= maxFiles || depth > maxDepth) return out;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(fullPath, { maxDepth, maxFiles }, depth + 1, out);
    else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function isSubpathOrEqual(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_");
}
