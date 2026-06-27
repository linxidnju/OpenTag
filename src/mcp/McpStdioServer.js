import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export class McpStdioServer {
  constructor({ core, logger }) {
    this.core = core;
    this.logger = logger;
  }

  async start() {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch (error) {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
        continue;
      }
      const response = await this.core.handleMessage(message);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  }
}
