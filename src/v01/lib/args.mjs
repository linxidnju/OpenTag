export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      out._.push(token);
      continue;
    }
    const key = token.replace(/^--?/, "");
    const next = argv[i + 1];
    if (next && !next.startsWith("-")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
