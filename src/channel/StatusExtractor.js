const CLOSED_PATTERNS = [
  /\b(done|fixed|closed|resolved|shipped|complete|completed|merged|approved)\b/i,
  /已完成|完成了|已解决|解决了|关闭|已合并|已上线|搞定/
];

const BLOCKED_PATTERNS = [
  /\b(blocked|blocking|waiting on|depends on|pending|needs approval|need approval)\b/i,
  /阻塞|卡住|等待|待.*审批|需要.*确认|依赖|还缺/
];

const OPEN_PATTERNS = [
  /\b(todo|open|remaining|follow up|need to|needs|still|not yet|wip)\b/i,
  /待办|未完成|还没|仍需|需要|跟进|处理中|未解决|进行中/
];

const OWNER_PATTERNS = [
  /\bowner[:：]\s*([@A-Za-z0-9._-]+)/i,
  /\bassignee[:：]\s*([@A-Za-z0-9._-]+)/i,
  /负责人[:：]\s*([@A-Za-z0-9._-]+)/,
  /由\s*([@A-Za-z0-9._\-\u4e00-\u9fa5]+)\s*(负责|处理)/
];

const WAITING_PATTERNS = [
  /\bwaiting on\s+([@A-Za-z0-9._-]+)/i,
  /\bblocked by\s+([@A-Za-z0-9._-]+)/i,
  /等待\s*([@A-Za-z0-9._\-\u4e00-\u9fa5]+)/,
  /卡在\s*([@A-Za-z0-9._\-\u4e00-\u9fa5]+)/
];

export class StatusExtractor {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  extract({ scan, topic }) {
    const query = normalize(topic || scan.topic || "");
    const relevant = [];
    const skipped = [];
    for (const thread of scan.threads || []) {
      const text = threadText(thread);
      const score = relevanceScore(text, query);
      const isRelevant = !query || score > 0 || hasStatusSignal(text);
      if (!isRelevant) {
        skipped.push(thread);
        continue;
      }
      relevant.push(this.extractThread({ thread, text, score, topic: query }));
    }

    const items = relevant.sort((a, b) => statusRank(a.status) - statusRank(b.status) || String(b.lastUpdateTs).localeCompare(String(a.lastUpdateTs)));
    return {
      topic: topic || scan.topic || "",
      channelId: scan.channelId,
      scannedThreadCount: scan.threads.length,
      relevantThreadCount: relevant.length,
      skippedThreadCount: skipped.length,
      items,
      counts: {
        open: items.filter((item) => item.status === "open").length,
        blocked: items.filter((item) => item.status === "blocked").length,
        closed: items.filter((item) => item.status === "closed").length,
        unclear: items.filter((item) => item.status === "unclear").length
      }
    };
  }

  extractThread({ thread, text, score, topic }) {
    const latest = [...(thread.messages || [])].reverse().find((message) => message.text) || thread.messages?.[0] || {};
    const status = inferStatus(text);
    return {
      id: `${thread.channelId}:${thread.threadTs}`,
      threadTs: thread.threadTs,
      permalink: thread.permalink,
      title: makeTitle(thread, topic),
      status,
      owner: firstMatch(text, OWNER_PATTERNS) || null,
      waitingOn: firstMatch(text, WAITING_PATTERNS) || null,
      evidence: latest.text || firstNonEmptyText(thread) || "",
      lastUpdateTs: thread.latestTs,
      messageCount: thread.messages?.length || 0,
      replyCount: thread.replyCount || 0,
      relevanceScore: score
    };
  }
}

function inferStatus(text) {
  const latest = text.slice(Math.max(0, text.length - 1200));
  if (matches(latest, BLOCKED_PATTERNS)) return "blocked";
  if (matches(latest, CLOSED_PATTERNS)) return "closed";
  if (matches(text, OPEN_PATTERNS)) return "open";
  return "unclear";
}

function makeTitle(thread, topic) {
  const first = firstNonEmptyText(thread) || topic || "Thread";
  return stripSlackMarkup(first)
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function threadText(thread) {
  return (thread.messages || []).map((message) => message.text || "").join("\n");
}

function firstNonEmptyText(thread) {
  return (thread.messages || []).find((message) => message.text)?.text || "";
}

function relevanceScore(text, topic) {
  if (!topic) return 1;
  const normalizedText = normalize(text);
  const terms = topic.split(/\s+/).filter((term) => term.length >= 2);
  return terms.reduce((score, term) => score + (normalizedText.includes(term) ? 1 : 0), 0);
}

function hasStatusSignal(text) {
  return matches(text, [...OPEN_PATTERNS, ...BLOCKED_PATTERNS, ...CLOSED_PATTERNS]);
}

function matches(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return stripSlackMarkup(match[1]).replace(/[，。,.;；:：]+$/, "");
  }
  return null;
}

function stripSlackMarkup(text) {
  return String(text || "")
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, "#$2")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .trim();
}

function normalize(text) {
  return stripSlackMarkup(text).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}

function statusRank(status) {
  if (status === "blocked") return 0;
  if (status === "open") return 1;
  if (status === "unclear") return 2;
  return 3;
}
