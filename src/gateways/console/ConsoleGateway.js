import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomId } from "../../utils/id.js";

export class ConsoleGateway {
  constructor({ config, engine, logger }) {
    this.config = config;
    this.engine = engine;
    this.logger = logger;
  }

  async start() {
    const rl = readline.createInterface({ input, output });
    console.log("OpenTag console gateway. Type a message, /opentag help, or Ctrl+C to exit.");
    const threadId = `console-${Date.now()}`;
    while (true) {
      const text = await rl.question("> ");
      if (!text.trim()) continue;
      const message = {
        platform: "console",
        workspaceId: "local",
        channelId: "console",
        threadId,
        messageId: randomId("msg"),
        userId: process.env.USER || "console-user",
        text,
        cleanText: text,
        isMention: true,
        raw: {}
      };
      await this.engine.handleIncomingMessage(message, createConsoleResponder());
    }
  }
}

function createConsoleResponder() {
  return {
    sendStatus: async (text) => console.log(`\n[status] ${text}`),
    sendText: async (text) => console.log(`\n${text}`),
    appendToken: async (text) => process.stdout.write(text),
    complete: async (text) => console.log(`\n[complete]\n${text}\n`),
    fail: async (text) => console.error(`\n[error] ${text}\n`),
    sendApproval: async (approval) => console.log(`\n[approval required] ${approval.id}: ${approval.reason}\n`)
  };
}
