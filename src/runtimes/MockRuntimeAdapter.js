export class MockRuntimeAdapter {
  constructor({ id, spec, logger }) {
    this.id = id;
    this.spec = spec;
    this.logger = logger;
  }

  describe() {
    return { id: this.id, type: "mock", streaming: true };
  }

  async *run({ prompt, session, signal }) {
    yield { type: "started", message: "Mock runtime started." };
    const lines = [
      "OpenTag mock runtime received the thread context.\n",
      `Session: ${session.id}\n`,
      "MVP checks: Slack gateway, session memory, policy, approval, runtime adapter, audit log.\n",
      "This is a deterministic response; switch to claude-code/codex/opencode runtime for real agent work."
    ];
    for (const line of lines) {
      if (signal?.aborted) throw new Error("aborted");
      await delay(this.spec.delayMs || 5);
      yield { type: "token", text: line };
    }
    yield { type: "completed", output: lines.join("") };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
