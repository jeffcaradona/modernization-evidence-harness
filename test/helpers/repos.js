import { mkdtemp, cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve('test/fixtures/synthetic');

async function git(cwd, ...args) {
  await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}

async function initCommittedRepo(sourceName) {
  const root = await mkdtemp(join(tmpdir(), `${sourceName}-`));
  await cp(join(fixtureRoot, sourceName), root, { recursive: true });
  await git(root, 'init');
  await git(root, 'config', 'user.name', 'Test User');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'fixture');
  return root;
}

export async function createSessionWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), 'evidence-harness-'));
  const legacyAPath = await initCommittedRepo('legacy-a');
  const legacyBPath = await initCommittedRepo('legacy-b');
  const toolkitPath = join(workspace, 'toolkit');
  const artifactsPath = join(workspace, 'artifacts');
  await cp(join(fixtureRoot, 'toolkit'), toolkitPath, { recursive: true });
  await mkdir(artifactsPath, { recursive: true });
  const configPath = join(workspace, 'harness.config.json');
  const config = {
    repositories: {
      'legacy-a': { rootPath: legacyAPath },
      'legacy-b': { rootPath: legacyBPath },
    },
    artifacts: { rootPath: artifactsPath },
    toolkit: {
      rootPath: toolkitPath,
      indexPath: join(toolkitPath, 'index.json'),
    },
    redaction: { secrets: ['TopSecret!', 'department-user'] },
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
  };
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return {
    workspace,
    legacyAPath,
    legacyBPath,
    toolkitPath,
    artifactsPath,
    configPath,
  };
}

export async function writeArtifactFiles(artifactsPath, { markdownRelativePath, markdownBody, manifestRelativePath, manifest }) {
  const markdownPath = join(artifactsPath, markdownRelativePath);
  const manifestPath = join(artifactsPath, manifestRelativePath);
  await mkdir(dirname(markdownPath), { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(markdownPath, markdownBody);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { markdownPath, manifestPath };
}
