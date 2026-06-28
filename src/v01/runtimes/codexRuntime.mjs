export function buildCodexExecArgs({ projectDir, prompt, sandbox = "workspace-write", json = true, ephemeral = true }) {
  const args = ["exec"];
  if (json) args.push("--json");
  if (ephemeral) args.push("--ephemeral");
  if (projectDir) args.push("--cd", projectDir);
  if (sandbox) args.push("--sandbox", sandbox);
  args.push(prompt);
  return args;
}
