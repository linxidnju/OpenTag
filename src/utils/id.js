import crypto from "node:crypto";

export function stableId(parts, prefix = "") {
  const input = Array.isArray(parts) ? parts.join(":") : String(parts);
  const digest = crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
  return prefix ? `${prefix}_${digest}` : digest;
}

export function randomId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

export function threadKey({ platform, workspaceId, channelId, threadId }) {
  return [platform, workspaceId, channelId, threadId].map((x) => String(x || "")).join(":");
}
