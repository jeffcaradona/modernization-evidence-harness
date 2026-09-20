import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSafeFileReader, createSensitivePathMatcher } from '../src/filesystem/safe-reader.js';
import { createRedactor } from '../src/redaction.js';
import { createRepositoryService } from '../src/repositories/repository-service.js';
import { createSessionWorkspace } from './helpers/repos.js';

const execFileAsync = promisify(execFile);

function createRunnerWithSearchOutput(searchOutput, captured) {
  return {
    async run(command, args, options = {}) {
      if (command === 'git') {
        const { stdout, stderr } = await execFileAsync(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env } });
        return { exitCode: 0, termSignal: null, stdout, stderr, stdoutTruncated: false, stderrTruncated: false };
      }
      if (command === 'rg') {
        captured.push(args);
        return {
          exitCode: 0,
          termSignal: null,
          stdout: searchOutput,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    },
  };
}

function createService(workspace, runner) {
  const redactor = createRedactor({ secrets: ['department-user'] });
  return createRepositoryService({
    repositories: {
      'legacy-a': { rootPath: workspace.legacyAPath },
      'legacy-b': { rootPath: workspace.legacyBPath },
    },
    runner,
    fileReader: createSafeFileReader({ redactor, sensitivePathMatcher: createSensitivePathMatcher() }),
    redactor,
    limits: {
      maxInventoryFiles: 20,
      maxSearchMatches: 10,
      maxSearchFileBytes: 262144,
      maxExcerptBytes: 4096,
      maxExcerptLines: 12,
      subprocessTimeoutMs: 5000,
      subprocessStdoutBytes: 1024 * 1024,
      subprocessStderrBytes: 128 * 1024,
    },
  });
}

test('inventory excludes sensitive paths and read excerpt yields direct observation evidence', async () => {
  const workspace = await createSessionWorkspace();
  const captured = [];
  const runner = createRunnerWithSearchOutput('', captured);
  const service = createService(workspace, runner);
  await service.initialize();

  const inventory = await service.inventorySolution({ repositoryAlias: 'legacy-a' });
  assert.equal(inventory.visiblePaths.includes('.env'), false);
  assert.deepEqual(inventory.solutionFiles, ['OrderEntry/ModernizationA.sln', 'OrderEntry/OrderEntry.vbproj']);

  const excerpt = await service.readSourceExcerpt({
    repositoryAlias: 'legacy-a',
    relativePath: 'OrderEntry/SubmitOrder.vb',
    lineStart: 3,
    lineCount: 4,
  });
  assert.equal(excerpt.evidenceItems[0].analysisMethod, 'Direct source observation');
  assert.match(excerpt.evidenceItems[0].excerpt, /\[REDACTED_FIELD\]/);
  const leftStatus = await execFileAsync('git', ['status', '--short'], {
    cwd: workspace.legacyAPath,
  });
  const rightStatus = await execFileAsync('git', ['status', '--short'], {
    cwd: workspace.legacyBPath,
  });
  assert.equal(leftStatus.stdout.trim(), '');
  assert.equal(rightStatus.stdout.trim(), '');
  assert.equal(captured.length, 0);
});

test('search preserves original query in execution but redacts reported query and orders evidence deterministically', async () => {
  const workspace = await createSessionWorkspace();
  const searchOutput = [
    JSON.stringify({ type: 'match', data: { path: { text: `${workspace.legacyAPath}/Shared/Workflow.vb` }, line_number: 2, lines: { text: '    Public Const SubmitOrder As String = "SubmitOrder"' } } }),
    JSON.stringify({ type: 'match', data: { path: { text: `${workspace.legacyAPath}/OrderEntry/SubmitOrder.vb` }, line_number: 5, lines: { text: '        Dim auditUser As String = "user id=department-user"' } } }),
  ].join('\n');
  const captured = [];
  const service = createService(workspace, createRunnerWithSearchOutput(searchOutput, captured));
  await service.initialize();

  const result = await service.searchRepository({ repositoryAlias: 'legacy-a', query: 'department-user' });
  assert.equal(captured[0][captured[0].length - 2], 'department-user');
  assert.equal(result.reportedQuery, '[REDACTED_SECRET]');
  assert.deepEqual(result.evidenceItems.map((item) => item.relativePath), ['OrderEntry/SubmitOrder.vb', 'Shared/Workflow.vb']);
});

test('search rejects malformed rg json output', async () => {
  const workspace = await createSessionWorkspace();
  const service = createService(
    workspace,
    createRunnerWithSearchOutput('{bad', [])
  );
  await service.initialize();

  await assert.rejects(
    () =>
      service.searchRepository({
        repositoryAlias: 'legacy-a',
        query: 'SubmitOrder',
      }),
    { code: 'E_SEARCH_OUTPUT_INVALID' }
  );
});

test('same relative path in different repositories yields distinct evidence identities', async () => {
  const workspace = await createSessionWorkspace();
  const runner = createRunnerWithSearchOutput('', []);
  const service = createService(workspace, runner);
  await service.initialize();

  const left = await service.readSourceExcerpt({ repositoryAlias: 'legacy-a', relativePath: 'Shared/Workflow.vb', lineStart: 1, lineCount: 3 });
  const right = await service.readSourceExcerpt({ repositoryAlias: 'legacy-b', relativePath: 'Shared/Workflow.vb', lineStart: 1, lineCount: 3 });
  assert.notEqual(left.evidenceItems[0].evidenceId, right.evidenceItems[0].evidenceId);
});

test('source drift is rejected after initialization', async () => {
  const workspace = await createSessionWorkspace();
  const runner = createRunnerWithSearchOutput('', []);
  const service = createService(workspace, runner);
  await service.initialize();

  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'drift'], { cwd: workspace.legacyAPath });
  await assert.rejects(() => service.inventorySolution({ repositoryAlias: 'legacy-a' }), {
    code: 'E_SOURCE_DRIFT',
  });
});
