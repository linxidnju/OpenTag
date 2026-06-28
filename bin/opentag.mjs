#!/usr/bin/env node
import { main } from "../src/v01/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
