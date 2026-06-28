import test from "node:test";
import assert from "node:assert/strict";
import { mapSlackEventToMessage, cleanSlackText, isBotOrSystemMessage } from "../src/gateways/slack/SlackMessageMapper.js";

test("cleanSlackText removes bot mention and broadcast mentions", () => {
  assert.equal(cleanSlackText("<@B1> hello <!here>", "B1"), "hello");
});

test("mapSlackEventToMessage uses context team id and thread id", () => {
  const msg = mapSlackEventToMessage({ event: { channel: "C1", thread_ts: "10.1", ts: "10.2", user: "U1", text: "<@B1> hi" }, botUserId: "B1", teamId: "T1" });
  assert.equal(msg.workspaceId, "T1");
  assert.equal(msg.threadId, "10.1");
  assert.equal(msg.cleanText, "hi");
  assert.equal(msg.isMention, true);
});

test("isBotOrSystemMessage detects bot/system subtypes", () => {
  assert.equal(isBotOrSystemMessage({ bot_id: "B" }), true);
  assert.equal(isBotOrSystemMessage({ subtype: "message_deleted" }), true);
  assert.equal(isBotOrSystemMessage({ user: "U" }), false);
});

test("cleanSlackText unwraps Slack links and mentions", () => {
  assert.equal(cleanSlackText("<@B1> see <https://example.com|Example> in <#C1|general>", "B1"), "see Example (https://example.com) in #general");
});

test("mapSlackEventToMessage normalizes files and bot self messages", () => {
  const msg = mapSlackEventToMessage({ event: { channel: "C1", ts: "1", user: "U1", text: "file", files: [{ id: "F1", name: "a.txt", mimetype: "text/plain", filetype: "txt", size: 3, url_private: "https://files/1", url_private_download: "https://files/1/download", permalink: "https://slack/file/1" }] }, botUserId: "B1", teamId: "T1", eventId: "E1" });
  assert.equal(msg.eventId, "E1");
  assert.equal(msg.files[0].name, "a.txt");
  assert.equal(msg.files[0].url_private_download, "https://files/1/download");
  assert.equal(msg.files[0].permalink, "https://slack/file/1");
  assert.equal(isBotOrSystemMessage({ user: "B1" }, "B1"), true);
});
