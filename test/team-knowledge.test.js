import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/loadConfig.js";

test("loadConfig supplies Team Knowledge defaults", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-knowledge-config-"));
  const file = path.join(dir, "config.json");
  try {
    await writeFile(file, JSON.stringify({
      app: { name: "OpenTag", dataDir: "./data" },
      runtimes: { default: "mock", adapters: { mock: { type: "mock" } } },
      workspaces: [{ workspaceId: "*", channels: [{ channelId: "*", defaultRuntime: "mock" }] }]
    }));
    const config = await loadConfig(file);
    assert.deepEqual(config.teamKnowledge, {
      enabled: true,
      maxContentChars: 4000,
      maxListEntries: 40,
      maxContextEntries: 40,
      maxContextChars: 12000
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
