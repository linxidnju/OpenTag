import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await mkdtemp(path.join(os.tmpdir(), "opentag-v01-"));
const env = { ...process.env, OPENTAG_HOME: path.join(tmp, "home") };

try {
  run(["./bin/opentag.mjs", "init", "--project", repo, "--runtime", "mock"], { env });
  await access(path.join(env.OPENTAG_HOME, ".env"));
  run(["./bin/opentag.mjs", "doctor", "--strict", "--offline"], { env });
  const doctorJson = run(["./bin/opentag.mjs", "doctor", "--strict", "--offline", "--json"], { env });
  const doctor = JSON.parse(doctorJson.stdout);
  if (!doctor.ok) throw new Error("doctor --json reported not ok");
  if (!Array.isArray(doctor.checks) || !doctor.checks.some((item) => item.name === "manifest:file")) throw new Error("doctor --json missing manifest:file check");
  const next = run(["./bin/opentag.mjs", "next"], { env });
  if (!next.stdout.includes("OpenTag next steps")) throw new Error("next did not print setup guidance");
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
