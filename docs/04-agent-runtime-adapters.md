# 04. Agent Runtime Adapters

## 1. 为什么要 Runtime Adapter

OpenTag 不应该把 Claude Code、Codex、OpenCode、Hermes Agent、OpenClaw 的细节写死在核心逻辑里。它们的 CLI、输出格式、会话机制、MCP 支持、权限模型都不同。

Adapter 层目标：

- 对上暴露统一 session/event API。
- 对下包装不同 Agent runtime。
- 把 runtime 输出统一转成 `AgentRuntimeEvent`。
- 把 OpenTag 的 policy、workspace、context 注入 runtime。

## 2. 统一接口

```ts
export interface AgentRuntimeAdapter {
  id: string;
  displayName: string;
  capabilities(): RuntimeCapabilities;

  start(input: AgentStartInput): AsyncIterable<AgentRuntimeEvent>;

  send?(input: AgentSendInput): Promise<void>;
  cancel?(input: AgentCancelInput): Promise<void>;
  resume?(input: AgentResumeInput): AsyncIterable<AgentRuntimeEvent>;
}

export interface RuntimeCapabilities {
  streaming: boolean;
  structuredEvents: boolean;
  resumable: boolean;
  supportsMcp: boolean;
  supportsSandbox: boolean;
  supportsApprovalMode: boolean;
  supportsUsageReport: boolean;
}
```

## 3. 统一输入

```ts
export interface AgentStartInput {
  sessionId: string;
  threadRef: ThreadRef;
  workspace: WorkspaceHandle;
  prompt: string;
  context: ContextBundle;
  allowedTools: string[];
  deniedTools: string[];
  env: Record<string, string>;
  cwd: string;
  timeoutMs: number;
  metadata: Record<string, unknown>;
}
```

## 4. 统一输出事件

```ts
export type AgentRuntimeEvent =
  | { type: 'started'; runtimeSessionId?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'message'; role: 'assistant' | 'system'; text: string }
  | { type: 'plan_update'; items: ChecklistItem[] }
  | { type: 'tool_call'; id: string; tool: string; input: unknown }
  | { type: 'tool_result'; id: string; tool: string; output: unknown; isError?: boolean }
  | { type: 'approval_request'; request: ApprovalRequest }
  | { type: 'artifact'; artifact: ArtifactRef }
  | { type: 'usage'; usage: UsageRecord }
  | { type: 'completed'; result: AgentResult }
  | { type: 'failed'; error: AgentError };
```

## 5. Claude Code Adapter

### 5.1 推荐接入方式

优先使用 Claude Agent SDK；如果要简单落地，使用 headless CLI：

```bash
claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages
```

可用能力：

- 结构化 JSON 输出。
- stream-json 实时事件。
- 内置文件读写、命令执行、代码编辑。
- MCP。
- permission mode。
- usage metadata。

### 5.2 Adapter 实现要点

- 启动子进程，cwd 指向 workspace。
- prompt 中包含 OpenTag context bundle。
- 解析 NDJSON。
- `stream_event` 转 `text_delta`。
- tool use / result 转 audit event。
- 最终 result 转 `completed`。
- session id 保存到 `runtime_session_id`。

### 5.3 风险

- Claude CLI 用户态配置可能影响行为。
- 本地 credential 泄露风险。
- 需要严格 cwd 和 env 控制。
- `bypassPermissions` 不应在生产默认开启。

## 6. Codex CLI Adapter

### 6.1 推荐接入方式

Codex 支持 non-interactive：

```bash
codex exec "<prompt>"
```

适合 CI、脚本、队列任务。OpenTag 可将 Slack task 转为 `codex exec` 任务。

### 6.2 Adapter 实现要点

- 使用 `codex exec` 执行一次性任务。
- 如果支持 JSON 输出，优先解析 JSON；否则解析 stdout/stderr。
- 在 session 表中记录 Codex session/log 路径。
- 对长任务用 worker timeout + cancellation。
- 通过环境变量或配置限制 sandbox/approval。

### 6.3 风险

- 不同 Codex 版本输出字段可能变化。
- 完整 trajectory 可能需要读取本地 session logs。
- 交互式审批不适合 Slack，必须由 OpenTag 接管审批。

## 7. OpenCode Adapter

### 7.1 推荐接入方式

OpenCode 支持：

```bash
opencode run "<message>"
opencode serve
opencode acp
opencode export <sessionID>
```

MVP 可以先用 `opencode run`，后续为了降低 MCP 冷启动和支持长期 session，使用 `opencode serve` 或 ACP。

### 7.2 Adapter 实现路径

- v1：`opencode run` 单次调用。
- v2：启动 `opencode serve` 常驻服务，OpenTag 通过 API/CLI attach。
- v3：通过 `opencode acp` 标准化接入。

### 7.3 优点

- 开源。
- 多 provider。
- MCP 支持。
- session export/import 可审计。

## 8. Hermes Agent Adapter

Hermes Agent 的公开定位是 self-improving agent，具备学习 loop、技能沉淀、跨会话记忆、隔离 sandbox backend。

OpenTag 接入建议：

- 第一版作为 external command runtime。
- 将 channel context 映射为 Hermes conversation/task。
- 将 Hermes 的技能/记忆与 OpenTag channel memory 区分开：Hermes 记忆属于 runtime 内部，OpenTag memory 属于协作层。
- 高风险工具仍由 OpenTag policy 控制，不完全交给 Hermes 自治。

潜在价值：Hermes 适合长期“团队助理”场景，不只是 coding。

## 9. OpenClaw Adapter / 集成策略

OpenClaw 已经是 self-hosted multi-channel gateway，且文档显示它连接多个 chat surfaces 到 AI coding agents。OpenTag 与它有重叠，但定位可以不同：

- OpenClaw 更像“现成 gateway/runtime ecosystem”。
- OpenTag 聚焦“Claude Tag-like team identity / channel-scoped governance / audit / access bundle”。

两种集成方式：

1. **OpenTag -> OpenClaw Runtime**：OpenTag 把任务交给 OpenClaw。
2. **OpenClaw -> OpenTag MCP**：OpenTag 暴露 MCP server，让 OpenClaw/Claude Code/Codex 读取和发送 channel conversation。

## 10. 自研 Agent Adapter

对于 ReverieAI 自研 Agent，可实现：

```ts
class ReverieAgentAdapter implements AgentRuntimeAdapter {
  async *start(input: AgentStartInput) {
    yield { type: 'started' };
    for await (const event of reverieAgent.run(input)) {
      yield mapReverieEvent(event);
    }
  }
}
```

## 11. Adapter 选择矩阵

| Runtime | MVP 难度 | 结构化输出 | 长 session | MCP | 开源 | 适合场景 |
|---|---:|---|---|---|---|---|
| Claude Code CLI | 低 | 强 | 中 | 强 | 部分 | coding 最强 demo |
| Claude Agent SDK | 中 | 强 | 强 | 强 | SDK | 生产级 Claude runtime |
| Codex CLI | 低 | 中 | 中 | 视版本 | 开源 | OpenAI 生态、CI |
| OpenCode | 中 | 强 | 强 | 强 | 开源 | 多模型开源 runtime |
| Hermes Agent | 中 | 待验证 | 强 | 视实现 | 开源 | 长期助理、自学习 |
| OpenClaw | 中 | 中 | 强 | 强 | 开源 | 多 channel gateway 互通 |
| 自研 Agent | 取决于实现 | 可控 | 可控 | 可控 | 自有 | 产品差异化 |

## 12. 最推荐 MVP 顺序

1. Claude Code CLI adapter：最快做出“Slack @bot 修 bug”的效果。
2. OpenCode adapter：证明 OpenTag 不绑定 Claude。
3. Codex CLI adapter：覆盖 OpenAI 用户。
4. 自研 Agent adapter：接入 ReverieAI 产品能力。
5. Hermes/OpenClaw adapter：做生态合作/对比。
