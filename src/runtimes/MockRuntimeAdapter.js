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
      "收到，我已经连上这个 Slack 线程。"
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
