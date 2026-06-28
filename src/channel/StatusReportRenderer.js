export class StatusReportRenderer {
  render(result) {
    const topic = result.topic ? `“${result.topic}”` : "这个频道";
    const actionable = result.items.filter((item) => item.status === "blocked" || item.status === "open");
    const lines = [];
    lines.push(`我看了最近的频道讨论，和 ${topic} 相关的 thread 有 ${result.relevantThreadCount} 个。`);
    lines.push(`状态：${result.counts.closed} 个已完成，${result.counts.open} 个待处理，${result.counts.blocked} 个阻塞，${result.counts.unclear} 个不明确。`);
    lines.push("");

    if (actionable.length) {
      lines.push("*仍需关注：*");
      for (const item of actionable.slice(0, 8)) lines.push(formatItem(item));
    } else {
      lines.push("没有发现明确仍待处理或阻塞的事项。");
    }

    const unclear = result.items.filter((item) => item.status === "unclear").slice(0, 3);
    if (unclear.length) {
      lines.push("");
      lines.push("*需要人工判断：*");
      for (const item of unclear) lines.push(formatItem(item));
    }

    lines.push("");
    lines.push(`来源：扫描 ${result.scannedThreadCount} 个 thread；报告基于 Slack 讨论自动抽取，重要结论建议点开来源核对。`);
    return lines.join("\n");
  }
}

function formatItem(item) {
  const status = item.status === "blocked" ? "阻塞" : item.status === "open" ? "待处理" : item.status === "closed" ? "已完成" : "不明确";
  const meta = [
    item.owner ? `负责人：${item.owner}` : "",
    item.waitingOn ? `等待：${item.waitingOn}` : ""
  ].filter(Boolean).join("，");
  const source = item.permalink ? ` <${item.permalink}|来源>` : "";
  const evidence = item.evidence ? ` — ${truncate(clean(item.evidence), 120)}` : "";
  return `- *${status}*：${clean(item.title)}${meta ? `（${meta}）` : ""}${evidence}${source}`;
}

function clean(text) {
  return String(text || "").replace(/```/g, "").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
