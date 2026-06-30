export const RUNTIME_EVENT_SCHEMA_VERSION = "opentag.runtime_event.v1";

const EVENT_ALIASES = {
  text_delta: "token",
  message: "token",
  approval_requested: "approval_request",
  approval: "approval_request",
  error: "failed"
};

export function normalizeRuntimeEvent(event) {
  if (!event || typeof event !== "object") {
    return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type: "log", message: String(event ?? "") };
  }
  const type = EVENT_ALIASES[event.type] || event.type || "log";
  if (type === "started") return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type, message: event.message || null, runtimeSessionId: event.runtimeSessionId || null };
  if (type === "token") return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type, text: String(event.text ?? event.delta ?? event.message ?? "") };
  if (type === "log") return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type, message: String(event.message ?? event.text ?? "") };
  if (type === "tool_call") {
    return {
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      type,
      id: event.id || null,
      name: event.name || event.tool || "tool",
      risk: event.risk || null,
      argumentsText: typeof event.argumentsText === "string" ? event.argumentsText : stringifyArguments(event.arguments || event.input || "")
    };
  }
  if (type === "tool_result") {
    return {
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      type,
      id: event.id || null,
      name: event.name || event.tool || "tool",
      output: event.output ?? null,
      isError: Boolean(event.isError)
    };
  }
  if (type === "approval_request") {
    const request = event.request || event;
    return {
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      type,
      reason: request.reason || event.reason || "Runtime requested approval",
      risks: request.risks || event.risks || ["runtime-request"]
    };
  }
  if (type === "artifact") {
    const artifact = event.artifact || event;
    return {
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      type,
      path: artifact.path,
      relativePath: artifact.relativePath || artifact.path,
      title: artifact.title || null,
      mimeType: artifact.mimeType || null
    };
  }
  if (type === "usage") return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type, usage: event.usage || event };
  if (type === "plan_update") return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type, items: event.items || [] };
  if (type === "completed") {
    const result = event.result || event;
    return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type, output: result.output || result.summary || event.output || event.summary || "" };
  }
  if (type === "failed") {
    const error = event.error || event.message || event;
    return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type, error: typeof error === "string" ? error : error.message || JSON.stringify(error) };
  }
  return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, type: "log", message: JSON.stringify(event) };
}

function stringifyArguments(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
