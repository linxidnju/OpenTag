import { FileStore } from "./storage/FileStore.js";
import { SandboxManager } from "./sandbox/SandboxManager.js";
import { RuntimeRegistry } from "./core/RuntimeRegistry.js";
import { PolicyEngine } from "./core/PolicyEngine.js";
import { ContextBuilder } from "./core/ContextBuilder.js";
import { SessionManager } from "./core/SessionManager.js";
import { OpenTagEngine } from "./core/OpenTagEngine.js";
import { SlackGateway } from "./gateways/slack/SlackGateway.js";
import { ConsoleGateway } from "./gateways/console/ConsoleGateway.js";
import { AdminServer } from "./admin/AdminServer.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";
import { McpServerCore } from "./mcp/McpServerCore.js";
import { McpStdioServer } from "./mcp/McpStdioServer.js";
import { createLogger } from "./utils/logger.js";

export async function buildOpenTag(config, options = {}) {
  const logger = options.logger || createLogger({ level: config.app.logLevel || "info" });
  const store = new FileStore({ rootDir: config.app.dataDir, logger });
  await store.init();

  const sandboxManager = new SandboxManager({ config: config.sandbox, logger });
  await sandboxManager.init();

  const runtimeRegistry = new RuntimeRegistry({ config: config.runtimes, logger });
  const policyEngine = new PolicyEngine({ config, logger });
  const contextBuilder = new ContextBuilder({ config, store, logger });
  const sessionManager = new SessionManager({ config, store, logger });

  const engine = new OpenTagEngine({
    config,
    store,
    sandboxManager,
    runtimeRegistry,
    policyEngine,
    contextBuilder,
    sessionManager,
    logger
  });

  const toolRegistry = new ToolRegistry({ config, store, logger });
  const mcpCore = new McpServerCore({ config, toolRegistry, logger });
  const mcpStdioServer = new McpStdioServer({ core: mcpCore, logger });
  const adminServer = new AdminServer({ config, engine, store, runtimeRegistry, logger });
  const slackGateway = new SlackGateway({ config, engine, logger });
  const consoleGateway = new ConsoleGateway({ config, engine, logger });

  return {
    config,
    logger,
    store,
    sandboxManager,
    runtimeRegistry,
    policyEngine,
    contextBuilder,
    sessionManager,
    engine,
    toolRegistry,
    mcpCore,
    mcpStdioServer,
    adminServer,
    slackGateway,
    consoleGateway
  };
}
