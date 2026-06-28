import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileStore } from "../src/storage/FileStore.js";
import { ChannelMemoryService } from "../src/memory/ChannelMemoryService.js";
import { createLogger } from "../src/utils/logger.js";

test("ChannelMemoryService saves public channel memory to workspace scope", async () => {
  const { store, dir } = await makeStore();
  const service = new ChannelMemoryService({ store, logger: silentLogger() });
  try {
    const entry = await service.remember({ workspaceId: "T1", channelId: "C_PUBLIC", channelType: "channel", text: "public launch fact", createdBy: "U1" });
    assert.equal(entry.scope, "workspace");
    const privateContext = await service.listForContext({ workspaceId: "T1", channelId: "G_PRIVATE", channelType: "group" });
    assert.ok(privateContext.some((item) => item.text === "public launch fact"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChannelMemoryService saves private channel memory to channel scope", async () => {
  const { store, dir } = await makeStore();
  const service = new ChannelMemoryService({ store, logger: silentLogger() });
  try {
    await service.remember({ workspaceId: "T1", channelId: "G_PRIVATE", channelType: "group", text: "private launch fact", createdBy: "U1" });
    const privateContext = await service.listForContext({ workspaceId: "T1", channelId: "G_PRIVATE", channelType: "group" });
    const publicContext = await service.listForContext({ workspaceId: "T1", channelId: "C_PUBLIC", channelType: "channel" });
    assert.ok(privateContext.some((item) => item.text === "private launch fact" && item.scope === "channel"));
    assert.ok(!publicContext.some((item) => item.text === "private launch fact"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-memory-"));
  const store = new FileStore({ rootDir: path.join(dir, "data"), logger: silentLogger() });
  await store.init();
  return { store, dir };
}

function silentLogger() {
  return createLogger({ level: "silent" });
}
