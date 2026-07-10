import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/loadConfig.js";
import { FileStore } from "../src/storage/FileStore.js";

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

test("FileStore persists isolated Team Knowledge partitions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-knowledge-store-"));
  const store = new FileStore({ rootDir: path.join(dir, "data"), logger: null });
  try {
    await store.init();
    const workspace = await store.getKnowledgePartition({ workspaceId: "T1", scope: "workspace" });
    workspace.records.push({ id: "kn_workspace" });
    workspace.operations["slack:E1"] = { knowledgeId: "kn_workspace", version: 1 };
    await store.saveKnowledgePartition({ workspaceId: "T1", scope: "workspace", partition: workspace });

    const channel = await store.getKnowledgePartition({ workspaceId: "T1", scope: "channel", channelId: "G1" });
    channel.records.push({ id: "kn_private" });
    await store.saveKnowledgePartition({ workspaceId: "T1", scope: "channel", channelId: "G1", partition: channel });

    assert.deepEqual((await store.getKnowledgePartition({ workspaceId: "T1", scope: "workspace" })).records.map((item) => item.id), ["kn_workspace"]);
    assert.deepEqual((await store.getKnowledgePartition({ workspaceId: "T1", scope: "channel", channelId: "G1" })).records.map((item) => item.id), ["kn_private"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
