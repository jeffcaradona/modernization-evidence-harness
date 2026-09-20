#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHarnessServer } from '../src/server.js';
import { createSubprocessRunner } from '../src/subprocess/runner.js';

const realRunner = createSubprocessRunner();

function parseOption(args, name, defaultValue) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return defaultValue;
  }
  return args[index + 1];
}

function createDeterministicRunner() {
  return {
    async run(command, args, options = {}) {
      if (command !== 'rg') {
        return realRunner.run(command, args, options);
      }

      const separatorIndex = args.indexOf('--');
      const query = args[separatorIndex + 1];
      const searchPaths = args.slice(separatorIndex + 2);
      const maxCount = Number.parseInt(parseOption(args, '--max-count', '20'), 10);
      const maxFileBytes = Number.parseInt(
        parseOption(args, '--max-filesize', `${256 * 1024}`),
        10
      );
      const matches = [];

      for (const relativePath of searchPaths) {
        const absolutePath = resolve(options.cwd ?? process.cwd(), relativePath);
        const body = await readFile(absolutePath, 'utf8').catch(() => null);
        if (body === null) {
          continue;
        }
        if (Buffer.byteLength(body) > maxFileBytes) {
          continue;
        }

        const lines = body.split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          if (!line.includes(query)) {
            continue;
          }
          matches.push(
            JSON.stringify({
              type: 'match',
              data: {
                path: { text: relativePath },
                line_number: index + 1,
                lines: { text: line },
              },
            })
          );
          if (matches.length >= maxCount) {
            return {
              exitCode: 0,
              termSignal: null,
              stdout: `${matches.join('\n')}\n`,
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }
        }
      }

      return {
        exitCode: matches.length > 0 ? 0 : 1,
        termSignal: null,
        stdout: matches.length > 0 ? `${matches.join('\n')}\n` : '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    },
  };
}

async function main() {
  const harness = await createHarnessServer({ runner: createDeterministicRunner() });
  const transport = new StdioServerTransport();
  await harness.server.connect(transport);
  console.error('modernization-evidence-harness test MCP server running on stdio');
}

main().catch((error) => {
  console.error('modernization-evidence-harness test server failed to start');
  console.error(error);
  process.exit(1);
});
