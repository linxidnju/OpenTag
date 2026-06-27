import { GenericCliRuntimeAdapter } from "./GenericCliRuntimeAdapter.js";

export class DockerRuntimeAdapter extends GenericCliRuntimeAdapter {
  constructor({ id, spec, logger }) {
    super({ id, spec: { outputMode: "text", promptMode: "stdin", ...spec }, logger });
  }

  describe() {
    return { id: this.id, type: "docker", image: this.spec.image, streaming: true };
  }

  buildCommand(input) {
    if (!this.spec.image) throw new Error(`Docker runtime ${this.id} requires image`);
    const mountMode = this.spec.readOnly ? "ro" : "rw";
    const args = [
      "run",
      "--rm",
      "-i",
      "--network", this.spec.network || "none",
      "-v", `${input.sandbox.workspaceRoot}:/workspace:${mountMode}`,
      "-w", "/workspace"
    ];
    if (Array.isArray(this.spec.env)) {
      for (const name of this.spec.env) args.push("-e", name);
    } else if (this.spec.env && typeof this.spec.env === "object") {
      for (const [key, value] of Object.entries(this.spec.env)) args.push("-e", `${key}=${value}`);
    }
    if (Array.isArray(this.spec.extraDockerArgs)) args.push(...this.spec.extraDockerArgs);
    args.push(this.spec.image);
    if (Array.isArray(this.spec.args)) args.push(...this.spec.args);
    return { command: this.spec.command || "docker", args };
  }
}
