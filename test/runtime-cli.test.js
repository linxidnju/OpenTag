import test from "node:test";
import assert from "node:assert/strict";
import { GenericCliRuntimeAdapter } from "../src/runtimes/GenericCliRuntimeAdapter.js";

test("GenericCliRuntimeAdapter streams text output", async () => {
  const adapter = new GenericCliRuntimeAdapter({ id: "echo", spec: { type: "generic-cli", command: process.execPath, args: ["-e", "process.stdout.write('hello')"], outputMode: "text", timeoutMs: 5000 }, logger: console });
  const events = [];
  for await (const event of adapter.run({ prompt: "ignored", session: { id: "s", threadId: "t" }, sandbox: { workspaceRoot: process.cwd(), dir: process.cwd() }, signal: new AbortController().signal })) {
    events.push(event);
  }
  assert.ok(events.some((e) => e.type === "token" && e.text === "hello"));
  assert.ok(events.some((e) => e.type === "completed"));
});

test("GenericCliRuntimeAdapter maps jsonl output", async () => {
  const code = "console.log(JSON.stringify({type:'custom', text:'hi'}));";
  const adapter = new GenericCliRuntimeAdapter({ id: "json", spec: { type: "generic-cli", command: process.execPath, args: ["-e", code], outputMode: "jsonl", timeoutMs: 5000 }, logger: console });
  const events = [];
  for await (const event of adapter.run({ prompt: "ignored", session: { id: "s", threadId: "t" }, sandbox: { workspaceRoot: process.cwd(), dir: process.cwd() }, signal: new AbortController().signal })) {
    events.push(event);
  }
  assert.ok(events.some((e) => e.type === "token" && e.text === "hi"));
  assert.ok(events.some((e) => e.type === "completed"));
});

test("GenericCliRuntimeAdapter can pass prompt through stdin", async () => {
  const adapter = new GenericCliRuntimeAdapter({ id: "stdin", spec: { type: "generic-cli", command: process.execPath, args: ["-e", "process.stdin.pipe(process.stdout)"], promptMode: "stdin", outputMode: "text", timeoutMs: 5000 }, logger: console });
  const events = [];
  for await (const event of adapter.run({ prompt: "from stdin", session: { id: "s", threadId: "t" }, sandbox: { workspaceRoot: process.cwd(), dir: process.cwd() }, signal: new AbortController().signal })) events.push(event);
  assert.ok(events.some((e) => e.type === "token" && e.text === "from stdin"));
});
