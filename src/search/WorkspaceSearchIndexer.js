export class WorkspaceSearchIndexer {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
  }

  async indexRuntimeContext({ workspaceId, channelId, threadMessages = [], pinnedItems = [], files = [] }) {
    if (this.config.workspaceSearch?.enabled === false) return [];
    const current = await this.store.getWorkspaceIndex(workspaceId, channelId);
    const documents = { ...(current.documents || {}) };
    const upserted = [];
    for (const doc of buildDocuments({ workspaceId, channelId, threadMessages, pinnedItems, files })) {
      documents[doc.id] = { ...(documents[doc.id] || {}), ...doc, updatedAt: new Date().toISOString() };
      upserted.push(doc);
    }
    await this.store.saveWorkspaceIndex(workspaceId, channelId, { workspaceId, channelId, documents });
    return upserted;
  }

  async search({ workspaceId, channelId, query, limit = null }) {
    if (this.config.workspaceSearch?.enabled === false) return [];
    const indexes = channelId && channelId !== "*"
      ? [await this.store.getWorkspaceIndex(workspaceId, channelId)]
      : await this.store.listWorkspaceIndexes({ workspaceId });
    const terms = tokenize(query);
    const max = Number(limit || this.config.workspaceSearch?.maxHits || 8);
    return indexes.flatMap((index) => Object.values(index.documents || {}))
      .map((doc) => ({ doc, score: scoreDocument(doc, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(b.doc.updatedAt || "").localeCompare(String(a.doc.updatedAt || "")))
      .slice(0, max)
      .map((item) => item.doc);
  }
}

function buildDocuments({ workspaceId, channelId, threadMessages, pinnedItems, files }) {
  const docs = [];
  for (const message of threadMessages || []) {
    const text = message.text || message.cleanText || "";
    if (!text) continue;
    docs.push({
      id: `msg:${workspaceId}:${channelId}:${message.ts || message.messageId || hash(text)}`,
      type: "message",
      workspaceId,
      channelId,
      threadTs: message.thread_ts || message.threadId || null,
      sourceTs: message.ts || message.messageId || null,
      text: normalizeText(text),
      source: message.permalink || null
    });
  }
  for (const pin of pinnedItems || []) {
    const text = pin.text || "";
    if (!text && !pin.files?.length) continue;
    docs.push({
      id: `pin:${workspaceId}:${channelId}:${pin.messageTs || hash(text)}`,
      type: "pin",
      workspaceId,
      channelId,
      sourceTs: pin.messageTs,
      text: normalizeText([text, ...(pin.files || []).map((file) => `${file.name || file.title || ""} ${file.mimetype || ""}`)].join("\n")),
      source: pin.permalink || null
    });
  }
  for (const file of files || []) {
    if (file.status !== "downloaded") continue;
    docs.push({
      id: `file:${workspaceId}:${channelId}:${file.id || file.path || hash(file.name)}`,
      type: "file",
      workspaceId,
      channelId,
      text: normalizeText([file.name, file.title, file.mimetype, file.textPreview].filter(Boolean).join("\n")),
      source: file.permalink || null,
      filePath: file.path,
      relativePath: file.relativePath
    });
  }
  return docs;
}

function scoreDocument(doc, terms) {
  if (!terms.length) return 0;
  const text = normalizeText(doc.text || "");
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function tokenize(text) {
  return normalizeText(text).split(/\s+/).filter((term) => term.length >= 2).slice(0, 12);
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s./_-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function hash(text) {
  let value = 0;
  for (const ch of String(text || "")) value = ((value << 5) - value + ch.charCodeAt(0)) | 0;
  return Math.abs(value).toString(16);
}
