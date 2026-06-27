const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(options = {}) {
  const levelName = String(options.level || "info").toLowerCase();
  const threshold = LEVELS[levelName] ?? LEVELS.info;
  const sink = options.sink || console;

  function log(level, message, meta) {
    if ((LEVELS[level] ?? 999) < threshold) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(meta && Object.keys(meta).length ? { meta } : {})
    };
    const line = JSON.stringify(record);
    if (level === "error") sink.error(line);
    else if (level === "warn") sink.warn(line);
    else sink.log(line);
  }

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta)
  };
}
