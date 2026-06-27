# 16. 测试与加固清单

## 1. 当前测试命令

```bash
npm run check
npm test
npm run smoke
find src bin scripts test -name '*.js' -print0 | xargs -0 -n1 node --check
```

当前结果见：

```text
TEST_RESULTS.md
```

## 2. 当前自动测试覆盖

- Engine session lifecycle。
- Unknown runtime override 不创建 session。
- Approval 创建与 approved 后 resume。
- Slash command。
- Run metadata 和 artifact collection。
- Policy allow / deny / require approval。
- Blocked user。
- Self approval policy。
- Static cwd / allowedRoots。
- Tool-call deny / approval。
- Generic CLI runtime text / JSONL / stdin prompt。
- Slack message cleaning / bot filtering / files metadata。
- FileStore sessions / messages / approvals / event dedupe / message dedupe / runs / artifacts。
- MCP initialize / tools/list / get_thread_context。
- Admin API health / sessions。

## 3. 手工 smoke test

```bash
npm run smoke
```

预期：

- 创建 console session。
- mock runtime 完成。
- 写入 session / message / audit / run。
- 没有缺失 memory 文件 warning。

## 4. Slack 手工测试

Socket Mode：

```bash
cp examples/env.example .env
set -a
source .env
set +a
npm run doctor
npm start
```

测试项：

1. 在频道 `@OpenTag hello`，应在 thread 回复。
2. 在同一个 thread 继续发消息，应继续已有 session。
3. 在普通频道直接发消息，不应触发。
4. 在 DM 里给 bot 发消息，应创建个人 session。
5. 发送 `/opentag sessions`，应返回最近 session。
6. 发送包含 `deploy` / `delete` 的请求，应触发 approval。
7. 点击 Approve once，runtime 应继续执行。
8. 点击 Deny，session 应回到 active 或保持安全状态。
9. 点击 Cancel session，应中断运行中的 runtime。

## 5. 生产前必须加固

### Slack

- 生产环境使用具体 workspace/channel 配置，不要长期使用 `*` 通配。
- 不要默认启用 `chat:write.public`。
- 定期轮换 Slack Bot Token / App Token。
- 打开 Slack app event retry 观测，确认 event dedupe 生效。

### Runtime

- Claude Code / Codex / OpenCode 不要直接运行在含 SSH key、云凭证、生产 secrets 的主机环境。
- 写权限 runtime 必须保留 approval。
- 禁止默认 `danger-full-access`。
- Runtime env 只传必要变量。
- Generic CLI 输出 JSONL 时要处理 malformed lines。

### Docker Sandbox

- 默认 `network: none`。
- 默认 readonly mount。
- 增加 CPU / memory / pids 限制。
- 增加 seccomp / AppArmor profile。
- 禁止挂载 Docker socket。
- 禁止挂载用户 `$HOME` 整目录。

### Storage

- FileStore 适合单机 MVP。
- 多实例部署建议迁移 Postgres。
- audit log 建议 append-only。
- artifact 文件建议接 S3 / R2 / GCS。

### Queue

- 当前 session queue 是进程内 Map。
- 多实例或长任务建议迁移 Redis / BullMQ / Temporal。
- 对长 runtime 加 heartbeat 和 timeout。

### Approval

- 当前已支持 prompt-level、runtime-level、tool-call event-level approval。
- 更生产化版本应做 tool proxy，拦截真实 filesystem/network/git 操作。
- 可对不同 tool 做不同审批人组。

### MCP

- `opentag.post_slack_reply` 默认关闭是正确默认值。
- 开启后建议强制 `requireApprovalForSlackPost=true`。
- MCP client 应只连接可信本地进程。

## 6. 下一阶段建议新增测试

- Slack Bolt integration test with mocked Web API。
- Socket Mode event envelope test。
- HTTP Events API signing secret test。
- Slack Web API 429 retry test。
- Runtime timeout / command not found test。
- Docker runtime no-network / readonly behavior test。
- Long Slack message chunking test。
- Multi-thread concurrent sessions test。
- Approval button payload test。
- Admin API auth test。
- MCP post_slack_reply approval test。
