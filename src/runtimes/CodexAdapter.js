import { GenericCliRuntimeAdapter } from "./GenericCliRuntimeAdapter.js";

export class CodexAdapter extends GenericCliRuntimeAdapter {
  constructor({ id, spec, logger }) {
    super({ id, spec: { outputMode: "jsonl", ...spec }, logger });
  }

  describe() {
    return { id: this.id, type: "codex", command: this.spec.command || "codex", streaming: true };
  }

  buildCommand(input) {
    const args = ["exec"];
    if (this.spec.json !== false) args.push("--json");
    if (this.spec.ephemeral !== false) args.push("--ephemeral");
    if (this.spec.sandbox) args.push("--sandbox", this.spec.sandbox);
    if (this.spec.model) args.push("--model", this.spec.model);
    if (this.spec.ignoreUserConfig) args.push("--ignore-user-config");
    if (this.spec.ignoreRules) args.push("--ignore-rules");
    if (Array.isArray(this.spec.extraArgs)) args.push(...this.spec.extraArgs);
    args.push(input.prompt);
    return { command: this.spec.command || "codex", args };
  }

  mapJsonEvent(obj, state) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.type === "thread.started") return { type: "log", message: `codex thread ${obj.thread_id || "started"}` };
    if (obj.type === "turn.started") return { type: "log", message: "codex turn started" };
    if (obj.type === "turn.failed") return { type: "failed", error: obj.error || JSON.stringify(obj) };
    if (obj.type === "error") return { type: "failed", error: obj.message || JSON.stringify(obj) };
    if (obj.type === "turn.completed") return { type: "completed", output: state.finalText.trim() };
    if (obj.type === "item.started" || obj.type === "item.completed") {
      const item = obj.item || {};
      if (item.type === "agent_message" || item.type === "assistant_message") {
        const text = item.text || item.message || "";
        if (text) {
          state.finalText += text;
          return { type: "token", text };
        }
      }
      if (["command_execution", "file_change", "mcp_tool_call", "web_search", "plan_update"].includes(item.type)) {
        return { type: "tool_call", name: item.type, risk: item.type === "command_execution" ? "command" : null };
      }
      return { type: "log", message: JSON.stringify(obj) };
    }
    return super.mapJsonEvent(obj, state);
  }
}
