import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createSessionWorkspace, writeArtifactFiles } from './helpers/repos.js';

const repoRoot = process.cwd();
const serverEntry = `${repoRoot}/src/index.js`;

test('stdio server keeps diagnostics off stdout before protocol traffic', async () => {
  const workspace = await createSessionWorkspace();
  const child = spawn('node', [serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MODERNIZATION_EVIDENCE_HARNESS_CONFIG: workspace.configPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdoutChunks = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
  await new Promise((resolve) => setTimeout(resolve, 150));
  child.kill('SIGTERM');
  await once(child, 'exit');

  assert.equal(Buffer.concat(stdoutChunks).length, 0);
});

test('stdio MCP server supports discovery, excerpt collection, and artifact validation', async () => {
  const workspace = await createSessionWorkspace();
  const toolkitIndex = JSON.parse(
    await readFile(`${workspace.toolkitPath}/index.json`, 'utf8')
  );
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverEntry],
    cwd: repoRoot,
    env: {
      ...process.env,
      MODERNIZATION_EVIDENCE_HARNESS_CONFIG: workspace.configPath,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'modernization-evidence-harness-test', version: '0.1.0' }, { capabilities: {} });

  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ['inventory_solution', 'read_source_excerpt', 'search_repository', 'validate_artifact_references']
  );

  const inventory = await client.callTool({ name: 'inventory_solution', arguments: { repositoryAlias: 'legacy-a' } });
  const inventoryBody = inventory.structuredContent;
  assert.equal(inventoryBody.ok, true);
  assert.equal(inventoryBody.inventory.visiblePaths.includes('.env'), false);

  const excerpt = await client.callTool({
    name: 'read_source_excerpt',
    arguments: {
      repositoryAlias: 'legacy-a',
      relativePath: 'OrderEntry/SubmitOrder.vb',
      lineStart: 3,
      lineCount: 4,
    },
  });
  const excerptBody = excerpt.structuredContent;
  const evidence = excerptBody.evidenceItems[0];
  assert.equal(evidence.analysisMethod, 'Direct source observation');

  await writeArtifactFiles(workspace.artifactsPath, {
    markdownRelativePath: 'requirements/order-submission.md',
    markdownBody: '# Candidate requirement\n',
    manifestRelativePath: 'requirements/order-submission.references.json',
    manifest: {
      artifactId: 'REQ-001',
      artifactType: 'requirement',
      status: 'candidate',
      evidenceReferences: [{ evidenceId: evidence.evidenceId, expectedSourceHash: evidence.sourceHash }],
      toolkitReferences: [
        {
          documentPath: 'department-toolkit.md',
          referenceId: 'TK-001',
          expectedDocumentHash: toolkitIndex.documents[0].documentHash,
        },
      ],
      traceability: [{ observedBehavior: 'SubmitOrder sends work to legacy-b', requirementId: 'REQ-001', toolkitReferenceId: 'TK-001' }],
    },
  });

  const validation = await client.callTool({
    name: 'validate_artifact_references',
    arguments: {
      artifactRelativePath: 'requirements/order-submission.md',
      manifestRelativePath: 'requirements/order-submission.references.json',
    },
  });
  const validationBody = validation.structuredContent;
  assert.equal(validationBody.validation.valid, true);

  await client.close();
  await transport.close();
});
