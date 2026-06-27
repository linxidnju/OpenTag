import { redact } from "../utils/redact.js";

export class HttpRuntimeAdapter {
  constructor({ id, spec, logger }) {
    this.id = id;
    this.spec = spec;
    this.logger = logger;
  }

  describe() {
    return { id: this.id, type: "http", endpoint: this.spec.endpoint, streaming: Boolean(this.spec.stream) };
  }

  async *run(input) {
    if (!this.spec.endpoint) throw new Error(`HTTP runtime ${this.id} requires endpoint`);
    yield { type: "started", message: `${this.id} HTTP runtime started.` };
    const headers = resolveHeaders(this.spec.headers || {});
    const response = await fetch(this.spec.endpoint, {
      method: this.spec.method || "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        prompt: input.prompt,
        message: input.message,
        session: input.session,
        sandbox: input.sandbox,
        metadata: this.spec.metadata || {}
      }),
      signal: input.signal
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: "failed", error: `HTTP ${response.status}: ${redact(text.slice(0, 2000))}` };
      return;
    }

    if (this.spec.stream) {
      yield* streamNdjson(response);
      return;
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { output: text };
    }
    if (Array.isArray(payload.events)) {
      for (const event of payload.events) yield normalizeEvent(event);
    }
    yield { type: "completed", output: payload.output || payload.summary || text };
  }
}

async function* streamNdjson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    yield { type: "completed", output: text };
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const event = parseLine(line);
      if (!event) continue;
      if (event.type === "token") finalText += event.text || "";
      yield event;
    }
  }
  if (buffer.trim()) {
    const event = parseLine(buffer);
    if (event) {
      if (event.type === "token") finalText += event.text || "";
      yield event;
    }
  }
  yield { type: "completed", output: finalText.trim() || "HTTP stream completed." };
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const withoutSsePrefix = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!withoutSsePrefix || withoutSsePrefix === "[DONE]") return null;
  try {
    return normalizeEvent(JSON.parse(withoutSsePrefix));
  } catch {
    return { type: "token", text: `${withoutSsePrefix}\n` };
  }
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") return { type: "log", message: String(event) };
  if (event.type) return event;
  if (event.text || event.delta || event.message) return { type: "token", text: String(event.text || event.delta || event.message) };
  if (event.output || event.summary) return { type: "completed", output: event.output || event.summary };
  return { type: "log", message: JSON.stringify(event) };
}

function resolveHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = String(value).replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)}/g, (_, name) => process.env[name] || "");
  }
  return out;
}
