#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHarnessServer } from './server.js';

async function main() {
  const harness = await createHarnessServer();
  const transport = new StdioServerTransport();
  await harness.server.connect(transport);
  console.error('modernization-evidence-harness MCP server running on stdio');
}

main().catch((error) => {
  console.error('modernization-evidence-harness failed to start');
  console.error(error);
  process.exit(1);
});
