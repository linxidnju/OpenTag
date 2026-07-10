const ID = "([A-Za-z0-9_.-]+)";
const ENGLISH_KINDS = new Set(["fact", "decision", "convention", "preference", "procedure"]);
const CHINESE_KINDS = new Map([
  ["事实", "fact"],
  ["决定", "decision"],
  ["约定", "convention"],
  ["偏好", "preference"],
  ["流程", "procedure"]
]);

export function parseKnowledgeCommand(text) {
  const value = String(text || "").trim();
  let match = value.match(new RegExp(`^(?:correct|update knowledge)\\s+${ID}[:：\\s]+([\\s\\S]+)$`, "i"));
  if (match) return { name: "correct", knowledgeId: match[1], text: match[2].trim() };
  match = value.match(new RegExp(`^(?:纠正|更新知识)\\s*${ID}[:：\\s]+([\\s\\S]+)$`, "i"));
  if (match) return { name: "correct", knowledgeId: match[1], text: match[2].trim() };

  for (const [name, patterns] of Object.entries({
    archive: ["archive(?: knowledge)?", "归档"],
    restore: ["restore(?: knowledge)?", "恢复"],
    forget: ["forget(?: memory| knowledge)?", "delete memory", "忘记", "删除记忆"],
    inspect: ["knowledge", "show knowledge", "查看知识"]
  })) {
    for (const pattern of patterns) {
      match = value.match(new RegExp(`^${pattern}\\s+${ID}$`, "i"));
      if (match) return { name, knowledgeId: match[1] };
    }
  }

  if (/^(?:knowledge|show knowledge|list knowledge|memory|show memory|list memory|what do you remember|查看知识|显示记忆|你记得什么|你记住了什么)\??$/i.test(value)) {
    return { name: "list" };
  }

  match = value.match(/^(?:remember|please remember)(?:\s+(fact|decision|convention|preference|procedure))?(?:\s+(?:for|in)\s+(?:this\s+)?channel)?[:：\s]+([\s\S]+)$/i);
  if (match) {
    const requestedKind = String(match[1] || "").toLowerCase();
    return { name: "remember", kind: ENGLISH_KINDS.has(requestedKind) ? requestedKind : "fact", text: match[2].trim() };
  }

  match = value.match(/^(?:记住|请记住|帮我记住)(事实|决定|约定|偏好|流程)?(?:这个频道|在这个频道)?[:：\s]+([\s\S]+)$/i);
  if (match) return { name: "remember", kind: CHINESE_KINDS.get(match[1]) || "fact", text: match[2].trim() };
  return null;
}
