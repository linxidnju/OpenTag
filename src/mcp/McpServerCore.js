export class McpServerCore {
  constructor({ config, toolRegistry, logger }) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.logger = logger;
    this.protocolVersion = config.mcp?.protocolVersion || "2025-06-18";
  }

  async handleMessage(message) {
    if (!message || typeof message !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(message, "id")) {
      await this.handleNotification(message);
      return null;
    }
    try {
      const result = await this.dispatch(message.method, message.params || {});
      return { jsonrpc: "2.0", id: message.id, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: error.message || String(error) }
      };
    }
  }

  async handleNotification(message) {
    if (message.method === "notifications/initialized") return;
    this.logger?.debug?.("mcp.notification", { method: message.method });
  }

  async dispatch(method, params) {
    if (method === "initialize") return this.initialize(params);
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: this.toolRegistry.listTools() };
    if (method === "tools/call") {
      const name = params.name;
      const args = params.arguments || {};
      if (!name) throw new Error("tools/call requires params.name");
      return this.toolRegistry.callTool(name, args);
    }
    throw new Error(`Unsupported MCP method: ${method}`);
  }

  initialize(params = {}) {
    return {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: this.config.mcp?.name || "opentag-mcp",
        version: this.config.app?.version || "0.2.0"
      },
      instructions: "Use OpenTag tools to inspect Slack-thread sessions, read context, append audit events, and request human approval."
    };
  }
}
