#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  console.error(message);
  process.exitCode = 1;
});
