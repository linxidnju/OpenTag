const TOKEN_PATTERNS = [
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /xapp-[A-Za-z0-9-]+/g,
  /sk-[A-Za-z0-9_\-]{20,}/g,
  /sk-proj-[A-Za-z0-9_\-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g
];

export function redact(input, extraValues = []) {
  if (input == null) return input;
  let text = typeof input === "string" ? input : JSON.stringify(input);
  for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, "[REDACTED]");
  for (const value of extraValues) {
    if (!value || typeof value !== "string" || value.length < 6) continue;
    text = text.split(value).join("[REDACTED]");
  }
  return text;
}

export function redactEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (/token|secret|key|password|credential/i.test(key)) out[key] = value ? "[REDACTED]" : value;
    else out[key] = value;
  }
  return out;
}
