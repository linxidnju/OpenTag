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

test("knowledge corrections preserve ordered versions under concurrency", async () => {
  const { dir, service } = await makeKnowledgeService();
  try {
    const entry = await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "v1", createdBy: "U1", operationId: "E1" });
    await Promise.all(["v2", "v3"].map((text, index) => service.correct({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id, text, updatedBy: `U${index + 2}`, operationId: `E${index + 2}` })));
    const current = await service.inspect({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id });
    assert.equal(current.currentVersion, 3);
    assert.deepEqual(current.versions.map((version) => version.version), [1, 2, 3]);
    assert.deepEqual(current.versions.map((version) => version.content).sort(), ["v1", "v2", "v3"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archive, restore, and forget have distinct behavior", async () => {
  const { dir, store, service } = await makeKnowledgeService();
  try {
    const entry = await service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "keep history", createdBy: "U1" });
    await service.archive({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id, actorId: "U1" });
    assert.equal((await service.listForContext({ workspaceId: "T1", channelId: "C1", channelType: "channel" })).length, 0);
    assert.equal((await service.inspect({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id })).status, "archived");
    await service.restore({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id, actorId: "U1" });
    assert.equal((await service.listForContext({ workspaceId: "T1", channelId: "C1", channelType: "channel" })).length, 1);
    await service.forget({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id, actorId: "U1" });
    assert.equal(await service.inspect({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id }), null);
    const deletionAudit = (await store.listAudit({ type: "knowledge.forgotten" })).at(-1);
    assert.equal(deletionAudit.knowledgeId, entry.id);
    assert.equal("content" in deletionAudit, false);
    assert.equal("versions" in deletionAudit, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy memory is visible and materializes after a successful correction", async () => {
  const { dir, store, service } = await makeKnowledgeService();
  try {
    const legacy = await store.createMemoryEntry({ workspaceId: "T1", scope: "workspace", text: "legacy v1", createdBy: "U1" });
    const before = await service.inspect({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: legacy.id });
    assert.equal(before.schemaVersion, "opentag.memory.legacy");
    const corrected = await service.correct({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: legacy.id, text: "knowledge v2", updatedBy: "U2" });
    assert.equal(corrected.id, legacy.id);
    assert.equal(corrected.currentVersion, 2);
    assert.deepEqual(corrected.versions.map((item) => item.content), ["legacy v1", "knowledge v2"]);
    assert.equal((await store.listMemoryEntries({ workspaceId: "T1" })).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("private knowledge IDs cannot be inspected or mutated from public channels", async () => {
  const { dir, service } = await makeKnowledgeService();
  try {
    const entry = await service.remember({ workspaceId: "T1", channelId: "G1", channelType: "group", text: "private", createdBy: "U1" });
    assert.equal(await service.inspect({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id }), null);
    assert.equal(await service.correct({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id, text: "leak", updatedBy: "U2" }), null);
    assert.equal(await service.archive({ workspaceId: "T1", channelId: "C1", channelType: "channel", knowledgeId: entry.id, actorId: "U2" }), null);
    assert.equal((await service.inspect({ workspaceId: "T1", channelId: "G1", channelType: "group", knowledgeId: entry.id })).content, "private");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge validates kind and content length", async () => {
  const { dir, service } = await makeKnowledgeService();
  try {
    service.config.maxContentChars = 4;
    await assert.rejects(() => service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "", createdBy: "U1" }), /content is required/);
    await assert.rejects(() => service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "abcde", createdBy: "U1" }), /exceeds 4/);
    await assert.rejects(() => service.remember({ workspaceId: "T1", channelId: "C1", channelType: "channel", text: "okay", kind: "rumor", createdBy: "U1" }), /Unsupported knowledge kind/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
