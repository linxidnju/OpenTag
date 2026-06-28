import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export class SlackFileManager {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  async downloadMessageFiles({ client, message, sandbox, store, sessionId, runtimeId }) {
    const files = Array.isArray(message?.files) ? message.files : [];
    if (!files.length || !client) return [];
    const inputDir = sandbox.inputDir || path.join(sandbox.dir, "inputs");
    await mkdir(inputDir, { recursive: true });
    const downloaded = [];
    for (const file of files) {
      const decision = validateSlackFile(file, this.config.slack || {});
      if (!decision.ok) {
        await store?.appendAudit?.({ type: "slack_file.skipped", sessionId, runtimeId, fileId: file.id, name: file.name || file.title, reason: decision.reason });
        downloaded.push({ ...file, status: "skipped", reason: decision.reason });
        continue;
      }
      try {
        const outputPath = path.join(inputDir, safeFileName(file.name || file.title || file.id || "slack-file"));
        const bytes = await downloadSlackFile({ client, file, tokenEnv: this.config.slack?.botTokenEnv });
        if (bytes.byteLength > decision.maxBytes) {
          await store?.appendAudit?.({ type: "slack_file.skipped", sessionId, runtimeId, fileId: file.id, name: file.name || file.title, reason: "file exceeds maxDownloadBytes" });
          downloaded.push({ ...file, status: "skipped", reason: "file exceeds maxDownloadBytes" });
          continue;
        }
        await writeFile(outputPath, Buffer.from(bytes));
        const info = await stat(outputPath);
        const record = {
          id: file.id,
          name: file.name || file.title || path.basename(outputPath),
          title: file.title,
          mimetype: file.mimetype,
          filetype: file.filetype,
          size: info.size,
          path: outputPath,
          relativePath: path.relative(sandbox.dir, outputPath),
          permalink: file.permalink,
          status: "downloaded",
          textPreview: await maybeReadText(outputPath, file)
        };
        downloaded.push(record);
        await store?.appendAudit?.({ type: "slack_file.downloaded", sessionId, runtimeId, fileId: file.id, name: record.name, path: record.path, size: record.size });
      } catch (error) {
        this.logger?.warn?.("slack_file.download_failed", { fileId: file.id, name: file.name, error: error.message });
        await store?.appendAudit?.({ type: "slack_file.download_failed", sessionId, runtimeId, fileId: file.id, name: file.name || file.title, error: error.message });
        downloaded.push({ ...file, status: "failed", reason: error.message });
      }
    }
    return downloaded;
  }
}

export function validateSlackFile(file, slackConfig) {
  const maxBytes = Number(slackConfig.maxDownloadBytes || 25_000_000);
  if (Number(file.size || 0) > maxBytes) return { ok: false, reason: "file exceeds maxDownloadBytes", maxBytes };
  const allowed = slackConfig.allowedFileTypes || ["csv", "txt", "md", "json", "png", "jpg", "jpeg", "pdf"];
  const ext = fileExtension(file);
  if (allowed.length && ext && !allowed.map((item) => String(item).toLowerCase()).includes(ext)) {
    return { ok: false, reason: `file type .${ext} is not allowed`, maxBytes };
  }
  if (!file.url_private_download && !file.url_private) return { ok: false, reason: "missing Slack private download URL", maxBytes };
  return { ok: true, maxBytes };
}

async function downloadSlackFile({ client, file, tokenEnv }) {
  if (typeof client.fetchFile === "function") return client.fetchFile(file);
  const token = client.token || process.env[tokenEnv || "SLACK_BOT_TOKEN"];
  if (!token) throw new Error("missing Slack bot token for file download");
  const response = await fetch(file.url_private_download || file.url_private, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Slack file download failed: ${response.status}`);
  return response.arrayBuffer();
}

async function maybeReadText(filePath, file) {
  const ext = fileExtension(file);
  if (!["csv", "txt", "md", "json"].includes(ext)) return "";
  const raw = await readFile(filePath, "utf8").catch(() => "");
  return raw.slice(0, 4000);
}

function fileExtension(file) {
  const value = String(file.filetype || path.extname(file.name || file.title || "").slice(1) || "").toLowerCase();
  if (value === "jpeg") return "jpg";
  return value;
}

function safeFileName(name) {
  return String(name || "file").replace(/[/:\\]/g, "_").replace(/^\.+$/, "file");
}
