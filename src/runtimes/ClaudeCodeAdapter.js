import { GenericCliRuntimeAdapter } from "./GenericCliRuntimeAdapter.js";

export class ClaudeCodeAdapter extends GenericCliRuntimeAdapter {
  constructor({ id, spec, logger }) {
    super({ id, spec: { outputMode: "jsonl", ...spec }, logger });
  }

  describe() {
    return { id: this.id, type: "claude-code", command: this.spec.command || "claude", streaming: true };
  }

  buildCommand(input) {
    const args = ["-p", input.prompt];
    const outputFormat = this.spec.outputFormat || "stream-json";
    if (outputFormat) args.push("--output-format", outputFormat);
    if (this.spec.model) args.push("--model", this.spec.model);
    if (this.spec.permissionMode) args.push("--permission-mode", this.spec.permissionMode);
    if (Array.isArray(this.spec.allowedTools) && this.spec.allowedTools.length) {
      args.push("--allowedTools", this.spec.allowedTools.join(","));
    }
    if (Array.isArray(this.spec.extraArgs)) args.push(...this.spec.extraArgs);
    return { command: this.spec.command || "claude", args };
  }

  mapJsonEvent(obj, state) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.type === "result") {
      const text = obj.result || obj.text || obj.message || "";
      if (text) state.finalText = String(text);
      return { type: "completed", output: state.finalText };
    }
    if (obj.type === "assistant" && obj.message && Array.isArray(obj.message.content)) {
      const chunks = [];
      for (const item of obj.message.content) {
        if (item.type === "text" && item.text) chunks.push(item.text);
        if (item.type === "tool_use") return { type: "tool_call", name: item.name || "claude_tool" };
      }
      const text = chunks.join("");
      if (text) {
        state.finalText += text;
        return { type: "token", text };
      }
    }
    if (obj.type === "system" || obj.type === "user") return { type: "log", message: JSON.stringify(obj) };
    if (obj.type === "error") return { type: "failed", error: obj.error || obj.message || JSON.stringify(obj) };
    return super.mapJsonEvent(obj, state);
  }
}
