import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/loadConfig.js";
import { FileStore } from "../src/storage/FileStore.js";
import { TeamKnowledgeService } from "../src/knowledge/TeamKnowledgeService.js";

const KNOWLEDGE_CONFIG = {
  enabled: true,
  maxContentChars: 4000,
  maxListEntries: 40,
  maxContextEntries: 40,
  maxContextChars: 12000
};

async function makeKnowledgeService() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-team-knowledge-"));
  const store = new FileStore({ rootDir: path.join(dir, "data"), logger: null });
  await store.init();
  const service = new TeamKnowledgeService({ config: KNOWLEDGE_CONFIG, store, logger: null });
  return { dir, store, service };
}

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

test("TeamKnowledgeService scopes public and private knowledge", async () => {
  const { dir, service } = await makeKnowledgeService();
  try {
    const publicEntry = await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "Public fact", kind: "fact", createdBy: "U1", operationId: "slack:E1" });
    const privateEntry = await service.remember({ workspaceId: "T1", channelId: "G1", channelType: "group", text: "Private fact", kind: "decision", createdBy: "U2", operationId: "slack:E2" });
    assert.equal(publicEntry.scope, "workspace");
    assert.equal(privateEntry.scope, "channel");
    assert.deepEqual((await service.listVisible({ workspaceId: "T1", channelId: "C1", channelType: "channel" })).map((item) => item.content), ["Public fact"]);
    assert.deepEqual((await service.listVisible({ workspaceId: "T1", channelId: "G1", channelType: "group" })).map((item) => item.content).sort(), ["Private fact", "Public fact"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TeamKnowledgeService is idempotent and serializes concurrent creates", async () => {
  const { dir, service } = await makeKnowledgeService();
  try {
    const first = await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "One", createdBy: "U1", operationId: "slack:E1" });
    const duplicate = await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "One", createdBy: "U1", operationId: "slack:E1" });
    assert.equal(duplicate.id, first.id);
    await Promise.all(["Two", "Three"].map((text, index) => service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text, createdBy: "U1", operationId: `slack:E${index + 2}` })));
    assert.equal((await service.listVisible({ workspaceId: "T1", channelId: "C1", channelType: "channel" })).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TeamKnowledgeService enforces context limits without cutting records", async () => {
  const { dir, service } = await makeKnowledgeService();
  try {
    service.config.maxContextEntries = 2;
    service.config.maxContextChars = 8;
    await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "alpha", createdBy: "U1" });
    await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "too-long", createdBy: "U1" });
    await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "beta", createdBy: "U1" });
    assert.deepEqual((await service.listForContext({ workspaceId: "T1", channelId: "C1", channelType: "channel" })).map((entry) => entry.content), ["beta"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt knowledge partitions are excluded from context", async () => {
  const { dir, store, service } = await makeKnowledgeService();
  try {
    await writeFile(store.knowledgePath("T1", "workspace"), "{broken json");
    assert.deepEqual(await service.listForContext({ workspaceId: "T1", channelId: "C1", channelType: "channel" }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
