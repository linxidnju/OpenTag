import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await mkdtemp(path.join(os.tmpdir(), "opentag-v01-"));
const env = { ...process.env, OPENTAG_HOME: path.join(tmp, "home") };

try {
  run(["./bin/opentag.mjs", "setup", "--local", "--project", repo, "--runtime", "mock"], { env });
  run(["./bin/opentag.mjs", "doctor", "--strict", "--offline"], { env });
  run(["./bin/opentag.mjs", "slack", "manifest", "--write", path.join(tmp, "manifest.yml")], { env });
  const projectList = run(["./bin/opentag.mjs", "project", "list"], { env });
  if (!projectList.stdout.includes(repo)) throw new Error("project list did not include setup project");
  run(["./bin/opentag.mjs", "runtime", "list"], { env });
  console.log("smoke-v01: OK");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${args.join(" ")} failed with status ${result.status}`);
  }
  return result;
}
