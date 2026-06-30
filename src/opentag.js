import { FileStore } from "./storage/FileStore.js";
import { SandboxManager } from "./sandbox/SandboxManager.js";
import { RuntimeRegistry } from "./core/RuntimeRegistry.js";
import { TaskRouter } from "./core/TaskRouter.js";
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
import { ChannelStatusService } from "./channel/ChannelStatusService.js";
import { SlackFileManager } from "./slack/SlackFileManager.js";
import { SlackPinnedContextReader } from "./slack/SlackPinnedContextReader.js";
import { SlackWorkspaceSearcher } from "./slack/SlackWorkspaceSearcher.js";
import { WorkspaceSearchIndexer } from "./search/WorkspaceSearchIndexer.js";
import { ArtifactUploader } from "./slack/ArtifactUploader.js";
import { ChannelMemoryService } from "./memory/ChannelMemoryService.js";
import { AgentProxy } from "./proxy/AgentProxy.js";
import { createLogger } from "./utils/logger.js";

export async function buildOpenTag(config, options = {}) {
  const logger = options.logger || createLogger({ level: config.app.logLevel || "info" });
  const store = new FileStore({ rootDir: config.app.dataDir, logger });
  await store.init();

  const sandboxManager = new SandboxManager({ config: config.sandbox, logger });
  await sandboxManager.init();

  const runtimeRegistry = new RuntimeRegistry({ config: config.runtimes, logger });
  const taskRouter = new TaskRouter({ config, runtimeRegistry, logger });
  const policyEngine = new PolicyEngine({ config, logger });
  const slackFileManager = new SlackFileManager({ config, logger });
  const pinnedContextReader = new SlackPinnedContextReader({ config, logger });
  const workspaceSearchIndexer = new WorkspaceSearchIndexer({ config, store, logger });
  const slackWorkspaceSearcher = new SlackWorkspaceSearcher({ config, logger });
  const channelMemoryService = new ChannelMemoryService({ store, logger });
  const agentProxy = new AgentProxy({ config, store, logger });
  const artifactUploader = new ArtifactUploader({ config, logger });
  const contextBuilder = new ContextBuilder({ config, store, logger });
  const sessionManager = new SessionManager({ config, store, logger });

  const engine = new OpenTagEngine({
    config,
    store,
    sandboxManager,
    runtimeRegistry,
    taskRouter,
    policyEngine,
    contextBuilder,
    sessionManager,
    slackFileManager,
    pinnedContextReader,
    workspaceSearchIndexer,
    slackWorkspaceSearcher,
    channelMemoryService,
    agentProxy,
    artifactUploader,
    logger
  });

  const toolRegistry = new ToolRegistry({ config, store, logger });
  const channelStatusService = new ChannelStatusService({ config, store, logger });
  const mcpCore = new McpServerCore({ config, toolRegistry, logger });
  const mcpStdioServer = new McpStdioServer({ core: mcpCore, logger });
  const adminServer = new AdminServer({ config, engine, store, runtimeRegistry, agentProxy, logger });
  const slackGateway = new SlackGateway({ config, engine, channelStatusService, logger });
  const consoleGateway = new ConsoleGateway({ config, engine, logger });

  return {
    config,
    logger,
    store,
    sandboxManager,
    runtimeRegistry,
    taskRouter,
    policyEngine,
    slackFileManager,
    pinnedContextReader,
    workspaceSearchIndexer,
    slackWorkspaceSearcher,
    channelMemoryService,
    agentProxy,
    artifactUploader,
    contextBuilder,
    sessionManager,
    engine,
    toolRegistry,
    channelStatusService,
    mcpCore,
    mcpStdioServer,
    adminServer,
    slackGateway,
    consoleGateway
  };
}
