import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FileStore } from "../src/storage/FileStore.js";

async function withStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-store-"));
  const store = new FileStore({ rootDir: dir, logger: console });
  await store.init();
  try { await fn(store); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("FileStore persists session by thread and messages", async () => {
  await withStore(async (store) => {
    const session = await store.saveSession({ id: "sess_1", platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "100.1", status: "active" });
    assert.equal(session.id, "sess_1");
    const found = await store.findSessionByThread({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "100.1" });
    assert.equal(found.id, "sess_1");
    await store.appendMessage("sess_1", { role: "user", text: "hello" });
    await store.appendMessage("sess_1", { role: "assistant", text: "hi" });
    const messages = await store.listMessages("sess_1", { limit: 1 });
    assert.deepEqual(messages.map((m) => m.text), ["hi"]);
  });
});

test("FileStore persists approvals", async () => {
  await withStore(async (store) => {
    await store.createApproval({ id: "appr_1", status: "pending", sessionId: "sess_1" });
    const approval = await store.getApproval("appr_1");
    assert.equal(approval.status, "pending");
    approval.status = "approved";
    await store.saveApproval(approval);
    assert.equal((await store.getApproval("appr_1")).status, "approved");
  });
});

test("FileStore dedupes events and messages", async () => {
  await withStore(async (store) => {
    assert.equal(await store.markEventSeen("evt_1", { platform: "slack" }), true);
    assert.equal(await store.markEventSeen("evt_1", { platform: "slack" }), false);
    await store.saveSession({ id: "sess_dedupe", platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "t", status: "active" });
    await store.appendMessage("sess_dedupe", { messageId: "m1", role: "user", text: "hello" });
    await store.appendMessage("sess_dedupe", { messageId: "m1", role: "user", text: "hello again" });
    const messages = await store.listMessages("sess_dedupe");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, "hello");
  });
});

test("FileStore lists runs and artifacts", async () => {
  await withStore(async (store) => {
    await store.saveRun({ id: "run_1", sessionId: "sess_1", status: "running" });
    await store.createArtifact({ id: "art_1", sessionId: "sess_1", runId: "run_1", path: "/tmp/a.txt" });
    assert.equal((await store.listRuns({ sessionId: "sess_1" })).length, 1);
    assert.equal((await store.listArtifacts({ sessionId: "sess_1" })).length, 1);
  });
});

test("FileStore persists channel reports by thread", async () => {
  await withStore(async (store) => {
    await store.saveChannelReport({ id: "report_1", channelId: "C1", threadTs: "100.1", topic: "launch", counts: { open: 1 } });
    await store.saveChannelReport({ id: "report_2", channelId: "C2", threadTs: "200.1", topic: "other", counts: { open: 0 } });
    const reports = await store.listChannelReports({ channelId: "C1", threadTs: "100.1" });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].id, "report_1");
  });
});

test("FileStore persists scoped memory entries", async () => {
  await withStore(async (store) => {
    const workspace = await store.createMemoryEntry({ workspaceId: "T1", scope: "workspace", text: "workspace fact", createdBy: "U1" });
    const channel = await store.createMemoryEntry({ workspaceId: "T1", channelId: "G1", scope: "channel", text: "private fact", createdBy: "U2" });
    const publicEntries = await store.listMemoryEntries({ workspaceId: "T1", channelId: "C1", includeWorkspace: true, includeChannel: false });
    assert.deepEqual(publicEntries.map((entry) => entry.text), ["workspace fact"]);
    const privateEntries = await store.listMemoryEntries({ workspaceId: "T1", channelId: "G1", includeWorkspace: true, includeChannel: true });
    assert.deepEqual(privateEntries.map((entry) => entry.text), ["workspace fact", "private fact"]);
    assert.equal(await store.deleteMemoryEntry({ workspaceId: "T1", channelId: "G1", memoryId: channel.id }), true);
    assert.equal(await store.deleteMemoryEntry({ workspaceId: "T1", channelId: "G1", memoryId: workspace.id }), true);
    assert.equal((await store.listMemoryEntries({ workspaceId: "T1", channelId: "G1", includeWorkspace: true, includeChannel: true })).length, 0);
  });
});
