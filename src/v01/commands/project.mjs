import path from "node:path";
import { defaultConfigPath, expandHome, projectBindingPath, projectsPath } from "../lib/paths.mjs";
import { pathExists, readJson, removeFile, writeJson } from "../lib/fs.mjs";

export async function runProject(args) {
  const action = args._[1] || "list";
  if (action === "add") return addProject(args);
  if (action === "bind" || action === "use") return bindProject(args);
  if (action === "allow-root" || action === "allow") return allowRoot(args);
  if (action === "list") return listProjects();
  if (action === "remove") return removeProject(args);
  throw new Error(`Unknown project action: ${action}`);
}

async function addProject(args) {
  const projectDir = path.resolve(expandHome(args._[2] || args.path || args.project || process.cwd()));
  const projects = await readJson(projectsPath(), { current: null, items: [] });
  const item = {
    name: args.name || path.basename(projectDir),
    path: projectDir,
    defaultRuntime: args.runtime || "codex",
    configPath: path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath())),
    updatedAt: new Date().toISOString()
  };
  projects.items = projects.items.filter((existing) => existing.path !== projectDir);
  projects.items.push(item);
  projects.current = projectDir;
  await writeJson(projectsPath(), projects);
  await writeJson(projectBindingPath(projectDir), item);
  console.log(`Added project: ${item.name} (${projectDir})`);
}

async function bindProject(args) {
  const target = path.resolve(expandHome(args._[2] || args.path || args.project || process.cwd()));
  const projects = await readJson(projectsPath(), { current: null, items: [] });
  const item = projects.items.find((candidate) => candidate.path === target) || {
    name: args.name || path.basename(target),
    path: target,
    defaultRuntime: args.runtime || "codex",
    configPath: path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath())),
    updatedAt: new Date().toISOString()
  };
  projects.items = projects.items.filter((candidate) => candidate.path !== target);
  projects.items.push(item);
  projects.current = target;
  await writeJson(projectsPath(), projects);
  await writeJson(projectBindingPath(target), item);
  console.log(`Using project: ${item.name} (${target})`);
}

async function listProjects() {
  const projects = await readJson(projectsPath(), { current: null, items: [] });
  if (!projects.items.length) {
    console.log("(no projects)");
    return;
  }
  for (const item of projects.items) {
    const marker = item.path === projects.current ? "*" : " ";
    console.log(`${marker} ${item.name.padEnd(24)} ${item.defaultRuntime || ""} ${item.path}`);
  }
}

async function removeProject(args) {
  const target = path.resolve(expandHome(args._[2] || args.path || args.project || process.cwd()));
  const projects = await readJson(projectsPath(), { current: null, items: [] });
  projects.items = projects.items.filter((candidate) => candidate.path !== target);
  if (projects.current === target) projects.current = projects.items[0]?.path || null;
  await writeJson(projectsPath(), projects);
  if (await pathExists(projectBindingPath(target))) await removeFile(projectBindingPath(target));
  console.log(`Removed project: ${target}`);
}

async function allowRoot(args) {
  const root = path.resolve(expandHome(args._[2] || args.path || args.root || process.cwd()));
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  const config = await readJson(configPath);
  if (!config) throw new Error(`Config not found: ${configPath}`);
  const workspaceId = args.workspace || args.workspaceId || "*";
  const channelId = args.channel || args.channelId || "*";
  const workspace = findOrCreateWorkspace(config, workspaceId);
  const channel = findOrCreateChannel(config, workspace, channelId);
  channel.allowedRoots = unique([...(channel.allowedRoots || []), root]);
  await writeJson(configPath, config);
  console.log(`Allowed root: ${root}`);
  console.log(`Config: ${configPath}`);
  console.log("Restart the daemon for this change to affect Slack events.");
}

function findOrCreateWorkspace(config, workspaceId) {
  config.workspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  let workspace = config.workspaces.find((item) => item.workspaceId === workspaceId);
  if (!workspace) {
    workspace = { workspaceId, channels: [] };
    config.workspaces.push(workspace);
  }
  return workspace;
}

function findOrCreateChannel(config, workspace, channelId) {
  workspace.channels = Array.isArray(workspace.channels) ? workspace.channels : [];
  let channel = workspace.channels.find((item) => item.channelId === channelId);
  if (!channel) {
    channel = {
      channelId,
      name: channelId === "*" ? "default" : channelId,
      defaultRuntime: config.runtimes?.default || "mock",
      allowedRuntimes: Object.keys(config.runtimes?.adapters || { mock: {} }),
      allowedUsers: [],
      blockedUsers: [],
      approvers: [],
      allowedRoots: [],
      workspaceRoot: config.sandbox?.workspaceRoot || null,
      instructions: "",
      memory: {},
      policy: { requireApprovalForWriteAccess: false, allowSelfApproval: true, requireApprovalPatterns: [], denyPatterns: [] },
      toolPolicy: { allowTools: ["Read", "Glob", "Grep", "LS", "Bash", "Edit", "Write", "MultiEdit", "WebSearch", "web_search"], denyTools: [], requireApprovalTools: [], requireApprovalPatterns: [], denyPatterns: [] }
    };
    workspace.channels.push(channel);
  }
  return channel;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
