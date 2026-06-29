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

test("GenericCliRuntimeAdapter filters secret-like environment variables by default", async () => {
  const previous = process.env.SLACK_BOT_TOKEN;
  process.env.SLACK_BOT_TOKEN = "xoxb-secret";
  try {
    const adapter = new GenericCliRuntimeAdapter({
      id: "env-filter",
      spec: { type: "generic-cli", command: process.execPath, args: ["-e", "process.stdout.write(process.env.SLACK_BOT_TOKEN || 'missing')"], outputMode: "text", timeoutMs: 5000 },
      logger: console
    });
    const events = [];
    for await (const event of adapter.run({ prompt: "ignored", session: { id: "s", threadId: "t" }, sandbox: { workspaceRoot: process.cwd(), dir: process.cwd() }, signal: new AbortController().signal })) events.push(event);
    assert.ok(events.some((e) => e.type === "token" && e.text === "missing"));
  } finally {
    if (previous === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = previous;
  }
});

test("GenericCliRuntimeAdapter can explicitly pass required runtime credentials", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test";
  try {
    const adapter = new GenericCliRuntimeAdapter({
      id: "env-explicit",
      spec: { type: "generic-cli", command: process.execPath, args: ["-e", "process.stdout.write(process.env.OPENAI_API_KEY || 'missing')"], env: { OPENAI_API_KEY: "${env:OPENAI_API_KEY}" }, outputMode: "text", timeoutMs: 5000 },
      logger: console
    });
    const events = [];
    for await (const event of adapter.run({ prompt: "ignored", session: { id: "s", threadId: "t" }, sandbox: { workspaceRoot: process.cwd(), dir: process.cwd() }, signal: new AbortController().signal })) events.push(event);
    assert.ok(events.some((e) => e.type === "token" && e.text === "sk-test"));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
