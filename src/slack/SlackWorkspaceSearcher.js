export class SlackWorkspaceSearcher {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  async search({ client, query, limit = null }) {
    const options = this.config.workspaceSearch || {};
    if (!options.enabled || !options.slackSearchEnabled) return [];
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) return [];
    const count = Number(limit || options.slackSearchMaxResults || 10);
    try {
      const result = await searchMessages({ client, query: cleanQuery, count, tokenEnv: options.userTokenEnv || "SLACK_USER_TOKEN" });
      return normalizeSearchMatches(result.messages?.matches || []);
    } catch (error) {
      this.logger?.warn?.("slack.workspace_search_failed", { error: error.message });
      return [];
    }
  }
}

async function searchMessages({ client, query, count, tokenEnv }) {
  const token = process.env[tokenEnv];
  if (token) return fetchSearchMessages({ token, query, count });
  if (client?.search?.messages && !client.token) {
    return client.search.messages({ query, count, sort: "timestamp", sort_dir: "desc" });
  }
  if (client?.search?.messages) {
    throw new Error(`missing Slack user token env ${tokenEnv}; bot tokens cannot use workspace search reliably`);
  }
  if (client?.apiCall && !client.token) {
    return client.apiCall("search.messages", { query, count, sort: "timestamp", sort_dir: "desc" });
  }
  if (!token) throw new Error(`missing Slack user token env ${tokenEnv}`);
  return fetchSearchMessages({ token, query, count });
}

async function fetchSearchMessages({ token, query, count }) {
  const params = new URLSearchParams({ query, count: String(count), sort: "timestamp", sort_dir: "desc" });
  const response = await fetch(`https://slack.com/api/search.messages?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Slack search.messages failed: ${response.status}`);
  const body = await response.json();
  if (!body.ok) throw new Error(body.error || "Slack search.messages failed");
  return body;
}

function normalizeSearchMatches(matches) {
  return matches.map((match) => ({
    id: `slack-search:${match.channel?.id || "unknown"}:${match.ts || match.iid || match.permalink || ""}`,
    type: "slack_search",
    workspaceId: match.team || null,
    channelId: match.channel?.id || null,
    channelName: match.channel?.name || null,
    sourceTs: match.ts || null,
    user: match.user || null,
    text: stripHighlights(match.text || ""),
    source: match.permalink || null
  })).filter((item) => item.text || item.source);
}

function stripHighlights(text) {
  return String(text || "")
    .replace(/\uE000|\uE001/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
