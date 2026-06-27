import { access } from "node:fs/promises";

const required = [
  "package.json",
  "bin/opentag.js",
  "src/core/OpenTagEngine.js",
  "src/gateways/slack/SlackGateway.js",
  "src/runtimes/CodexAdapter.js",
  "src/runtimes/ClaudeCodeAdapter.js",
  "examples/opentag.config.example.json",
  "examples/slack-app-manifest.yaml"
];

let ok = true;
for (const file of required) {
  try {
    await access(file);
    console.log(`✓ ${file}`);
  } catch {
    ok = false;
    console.error(`✗ missing ${file}`);
  }
}
if (!ok) process.exitCode = 1;
