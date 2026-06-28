import { createReadStream } from "node:fs";
import path from "node:path";

export class ArtifactUploader {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  isEnabled() {
    return this.config?.slack?.uploadArtifacts !== false;
  }

  async uploadArtifacts({ client, channelId, threadTs, artifacts, store, sessionId, runtimeId }) {
    if (!this.isEnabled() || !client || !artifacts?.length) return [];
    const uploaded = [];
    for (const artifact of artifacts) {
      try {
        const result = await uploadOne({ client, channelId, threadTs, artifact });
        uploaded.push({ artifactId: artifact.id, ok: true, result });
        await store?.appendAudit?.({ type: "artifact.uploaded", sessionId, runtimeId, artifactId: artifact.id, channelId, threadTs, path: artifact.path });
      } catch (error) {
        this.logger?.warn?.("artifact.upload_failed", { artifactId: artifact.id, path: artifact.path, error: error.message });
        uploaded.push({ artifactId: artifact.id, ok: false, error: error.message });
        await store?.appendAudit?.({ type: "artifact.upload_failed", sessionId, runtimeId, artifactId: artifact.id, channelId, threadTs, error: error.message });
      }
    }
    return uploaded;
  }
}

async function uploadOne({ client, channelId, threadTs, artifact }) {
  const filename = path.basename(artifact.path);
  const title = artifact.title || artifact.relativePath || filename;
  if (client.files?.uploadV2) {
    return client.files.uploadV2({
      channel_id: channelId,
      thread_ts: threadTs,
      file: createReadStream(artifact.path),
      filename,
      title
    });
  }
  if (client.files?.upload) {
    return client.files.upload({
      channels: channelId,
      thread_ts: threadTs,
      file: createReadStream(artifact.path),
      filename,
      title
    });
  }
  if (typeof client.uploadArtifact === "function") return client.uploadArtifact({ channelId, threadTs, artifact });
  throw new Error("Slack file upload API is not available");
}
