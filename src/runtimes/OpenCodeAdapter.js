import { GenericCliRuntimeAdapter } from "./GenericCliRuntimeAdapter.js";

export class OpenCodeAdapter extends GenericCliRuntimeAdapter {
  constructor({ id, spec, logger }) {
    super({ id, spec: { outputMode: "text", ...spec }, logger });
  }

  describe() {
    return { id: this.id, type: "opencode", command: this.spec.command || "opencode", streaming: true };
  }

  buildCommand(input) {
    if (Array.isArray(this.spec.args)) return super.buildCommand(input);
    const args = ["run", input.prompt];
    if (Array.isArray(this.spec.extraArgs)) args.push(...this.spec.extraArgs);
    return { command: this.spec.command || "opencode", args };
  }
}
