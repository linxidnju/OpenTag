import { MockRuntimeAdapter } from "../runtimes/MockRuntimeAdapter.js";
import { ClaudeCodeAdapter } from "../runtimes/ClaudeCodeAdapter.js";
import { CodexAdapter } from "../runtimes/CodexAdapter.js";
import { OpenCodeAdapter } from "../runtimes/OpenCodeAdapter.js";
import { GenericCliRuntimeAdapter } from "../runtimes/GenericCliRuntimeAdapter.js";
import { HttpRuntimeAdapter } from "../runtimes/HttpRuntimeAdapter.js";
import { DockerRuntimeAdapter } from "../runtimes/DockerRuntimeAdapter.js";

export class RuntimeRegistry {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.adapters = new Map();
    for (const [id, spec] of Object.entries(config.adapters || {})) {
      this.adapters.set(id, createAdapter(id, spec, logger));
    }
  }

  has(runtimeId) {
    return this.adapters.has(runtimeId);
  }

  get(runtimeId) {
    const adapter = this.adapters.get(runtimeId);
    if (!adapter) throw new Error(`Runtime adapter not registered: ${runtimeId}`);
    return adapter;
  }

  getSpec(runtimeId) {
    const spec = this.config.adapters[runtimeId];
    if (!spec) throw new Error(`Runtime spec not found: ${runtimeId}`);
    return spec;
  }

  list() {
    return [...this.adapters.values()].map((adapter) => adapter.describe());
  }
}

function createAdapter(id, spec, logger) {
  if (spec.type === "mock") return new MockRuntimeAdapter({ id, spec, logger });
  if (spec.type === "claude-code") return new ClaudeCodeAdapter({ id, spec, logger });
  if (spec.type === "codex") return new CodexAdapter({ id, spec, logger });
  if (spec.type === "opencode") return new OpenCodeAdapter({ id, spec, logger });
  if (spec.type === "generic-cli") return new GenericCliRuntimeAdapter({ id, spec, logger });
  if (spec.type === "http") return new HttpRuntimeAdapter({ id, spec, logger });
  if (spec.type === "docker") return new DockerRuntimeAdapter({ id, spec, logger });
  throw new Error(`Unsupported runtime type: ${spec.type}`);
}
