# Test Results

Date: 2026-06-26

Repository: OpenTag Enhanced MVP v0.2.0

Commands run:

```bash
npm test
npm run check
find src test scripts bin -name '*.js' -print0 | xargs -0 -n1 node --check
node ./bin/opentag.js run --config examples/opentag.config.example.json --runtime mock --prompt "hello enhanced OpenTag"
node ./bin/opentag.js doctor --config examples/opentag.config.example.json
```

Result:

```text
npm test: 30 tests passed, 0 failed
npm run check: OK
node --check: OK for src/test/scripts/bin JavaScript files
mock smoke run: OK
doctor: OK command execution; warns when optional Slack tokens / local agent CLIs / Docker are not installed
```

Observed test output summary:

```text
1..30
# tests 30
# suites 0
# pass 30
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Covered areas:

- Engine session lifecycle, runtime execution, unknown runtime rejection.
- Human approval creation and approval-based resume.
- Runtime run metadata recording and sandbox artifact collection.
- Slash command handling.
- Policy allow / deny / require approval.
- Blocked user handling, self-approval policy, static cwd allowed-roots validation.
- Tool-call policy: disallowed tool denial and risky tool approval.
- Generic CLI runtime text streaming, JSONL event mapping, stdin prompt mode.
- Slack message normalization, link/channel mention cleanup, file metadata, bot/self/system filtering.
- FileStore session/message persistence, approvals, event dedupe, message dedupe, runs, artifacts.
- MCP initialize, tools/list, get_thread_context.
- Admin API health, sessions, runs and artifacts endpoints.

Notes:

- Tests validate the local MVP behavior and core invariants.
- External Slack, Claude Code, Codex, OpenCode, Docker and HTTP runtime behavior still depends on correct local credentials, installed CLIs, Slack app scopes, runtime permissions and host environment.
- `doctor` intentionally reports missing `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `@slack/bolt`, `yaml`, Claude Code, Codex, OpenCode and Docker in this sandbox because those credentials/dependencies are not installed here. `npm install` is required before running the Slack gateway.
