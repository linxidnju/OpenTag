import { spawn } from "node:child_process";
import { AsyncQueue } from "../utils/AsyncQueue.js";
import { redact } from "../utils/redact.js";

export class GenericCliRuntimeAdapter {
  constructor({ id, spec, logger }) {
    this.id = id;
    this.spec = spec;
    this.logger = logger;
  }

  describe() {
    return { id: this.id, type: this.spec.type || "generic-cli", command: this.spec.command, streaming: true };
  }

  buildCommand(input) {
    const command = this.spec.command || "sh";
    const templateArgs = this.spec.args || ["-lc", "cat"];
    const args = templateArgs.map((arg) => interpolate(arg, input));
    return { command, args };
  }

  mapJsonEvent(obj, state) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.type === "error") return { type: "failed", error: obj.message || JSON.stringify(obj) };
    if (["approval_request", "approval.requested"].includes(obj.type)) {
      return { type: "approval_request", reason: obj.reason || obj.message || "runtime requested approval", risks: obj.risks || ["runtime-request"] };
    }
    if (obj.type === "artifact") return { type: "artifact", path: obj.path, title: obj.title, mimeType: obj.mimeType };
    if (obj.type && String(obj.type).includes("tool")) return { type: "tool_call", name: obj.name || obj.tool || obj.type, risk: obj.risk || null, argumentsText: obj.argumentsText || obj.arguments || "" };
    const text = obj.text || obj.message || obj.output || obj.delta;
    if (text) {
      state.finalText += String(text);
      return { type: "token", text: String(text) };
    }
    return { type: "log", message: JSON.stringify(obj) };
  }

  async *run(input) {
    const { command, args } = this.buildCommand(input);
    const cwd = this.spec.cwd ? interpolate(this.spec.cwd, input) : input.sandbox.workspaceRoot;
    const timeoutMs = Number(this.spec.timeoutMs || (this.spec.timeoutSeconds ? this.spec.timeoutSeconds * 1000 : 600000));
    const maxOutputBytes = Number(this.spec.maxOutputBytes || 2_000_000);
    const outputMode = this.spec.outputMode || "text";
    const queue = new AsyncQueue();
    const state = { finalText: "", stdoutBytes: 0, stderrBytes: 0 };

    yield { type: "started", message: `${this.id} launching: ${command} ${args.map(shellQuote).join(" ")}` };

    const child = spawn(command, args, {
      cwd,
      env: resolveEnv(this.spec.env || {}, input, this.id),
      shell: Boolean(this.spec.shell),
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdinPayload = this.spec.stdin ? interpolate(this.spec.stdin, input) : (this.spec.promptMode === "stdin" ? input.prompt : "");
    if (stdinPayload) child.stdin.write(stdinPayload);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    timer.unref();

    if (input.signal) {
      input.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
      }, { once: true });
    }

    let stdoutLineBuffer = "";
    child.stdout.on("data", (chunk) => {
      state.stdoutBytes += chunk.length;
      if (state.stdoutBytes > maxOutputBytes) {
        queue.push({ type: "failed", error: `stdout exceeded maxOutputBytes=${maxOutputBytes}` });
        child.kill("SIGTERM");
        return;
      }
      const text = redact(chunk.toString("utf8"));
      if (outputMode === "jsonl") {
        stdoutLineBuffer += text;
        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() || "";
        for (const line of lines) {
          const event = parseJsonLineToEvent(line, state, this);
          if (event) queue.push(event);
        }
      } else {
        state.finalText += text;
        queue.push({ type: "token", text });
      }
    });

    child.stderr.on("data", (chunk) => {
      state.stderrBytes += chunk.length;
      if (state.stderrBytes > maxOutputBytes) return;
      queue.push({ type: "log", message: redact(chunk.toString("utf8")) });
    });

    child.on("error", (error) => queue.fail(error));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (outputMode === "jsonl" && stdoutLineBuffer.trim()) {
        const event = parseJsonLineToEvent(stdoutLineBuffer, state, this);
        if (event) queue.push(event);
      }
      if (code === 0) queue.push({ type: "completed", output: state.finalText.trim() });
      else queue.push({ type: "failed", error: `${command} exited with code=${code} signal=${signal || "none"}` });
      queue.close();
    });

    for await (const event of queue) yield event;
  }
}

function parseJsonLineToEvent(line, state, adapter) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    return adapter.mapJsonEvent(obj, state);
  } catch {
    state.finalText += `${trimmed}\n`;
    return { type: "token", text: `${trimmed}\n` };
  }
}

export function interpolate(template, input) {
  return String(template)
    .replaceAll("{prompt}", input.prompt || "")
    .replaceAll("{sessionId}", input.session?.id || "")
    .replaceAll("{threadId}", input.session?.threadId || "")
    .replaceAll("{workspaceId}", input.session?.workspaceId || "")
    .replaceAll("{channelId}", input.session?.channelId || "")
    .replaceAll("{workspaceDir}", input.sandbox?.workspaceRoot || "")
    .replaceAll("{sandboxDir}", input.sandbox?.dir || "");
}

function resolveEnv(envSpec, input, runtimeId) {
  const resolved = {
    ...process.env,
    OPENTAG_RUNTIME_ID: runtimeId,
    OPENTAG_SESSION_ID: input.session?.id || "",
    OPENTAG_THREAD_ID: input.session?.threadId || "",
    OPENTAG_WORKSPACE_ID: input.session?.workspaceId || "",
    OPENTAG_CHANNEL_ID: input.session?.channelId || "",
    OPENTAG_SANDBOX_DIR: input.sandbox?.dir || "",
    OPENTAG_WORKSPACE_DIR: input.sandbox?.workspaceRoot || ""
  };
  for (const [key, value] of Object.entries(envSpec || {})) {
    resolved[key] = interpolate(String(value), input).replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)}/g, (_, name) => process.env[name] || "");
  }
  return resolved;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
