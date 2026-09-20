import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as z from 'zod/v4';
import { HarnessError } from './errors.js';

const repositorySchema = z.object({
  rootPath: z.string().min(1),
});

const configSchema = z.object({
  repositories: z.object({
    'legacy-a': repositorySchema,
    'legacy-b': repositorySchema,
  }),
  artifacts: z.object({
    rootPath: z.string().min(1),
  }),
  toolkit: z
    .object({
      rootPath: z.string().min(1),
      indexPath: z.string().min(1),
    })
    .optional(),
  redaction: z
    .object({
      secrets: z.array(z.string()).default([]),
    })
    .default({ secrets: [] }),
  limits: z
    .object({
      maxInventoryFiles: z.number().int().positive().default(200),
      maxSearchMatches: z.number().int().positive().default(20),
      maxSearchFileBytes: z.number().int().positive().default(262144),
      maxExcerptBytes: z.number().int().positive().default(16384),
      maxExcerptLines: z.number().int().positive().default(40),
      subprocessTimeoutMs: z.number().int().positive().default(15000),
      subprocessStdoutBytes: z.number().int().positive().default(2 * 1024 * 1024),
      subprocessStderrBytes: z.number().int().positive().default(256 * 1024),
    })
    .default({}),
});

function ensureAbsolute(pathValue, label) {
  if (!/^(?:[a-zA-Z]:[\\/]|\/)/.test(pathValue)) {
    throw new HarnessError('E_CONFIG_INVALID', `${label} must be an absolute path.`, {
      pathValue,
    });
  }
}

function assertArtifactsOutsideSources(artifactsRoot, repositories) {
  for (const [alias, repo] of Object.entries(repositories)) {
    if (artifactsRoot.startsWith(repo.rootPath)) {
      throw new HarnessError(
        'E_CONFIG_INVALID',
        'Artifact output must be outside both approved repository roots.',
        { alias, artifactsRoot }
      );
    }
  }
}

export async function loadConfig({ configPath }) {
  if (!configPath) {
    throw new HarnessError(
      'E_CONFIG_MISSING',
      'Set MODERNIZATION_EVIDENCE_HARNESS_CONFIG to an absolute JSON config path.'
    );
  }

  const resolvedConfigPath = resolve(configPath);
  const raw = await readFile(resolvedConfigPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new HarnessError('E_CONFIG_MISSING', 'Configuration file does not exist.', {
        configPath: resolvedConfigPath,
      });
    }
    throw error;
  });

  const parsed = configSchema.parse(JSON.parse(raw));
  for (const [alias, repo] of Object.entries(parsed.repositories)) {
    ensureAbsolute(repo.rootPath, `${alias}.rootPath`);
  }
  ensureAbsolute(parsed.artifacts.rootPath, 'artifacts.rootPath');
  if (parsed.toolkit) {
    ensureAbsolute(parsed.toolkit.rootPath, 'toolkit.rootPath');
    ensureAbsolute(parsed.toolkit.indexPath, 'toolkit.indexPath');
  }
  assertArtifactsOutsideSources(parsed.artifacts.rootPath, parsed.repositories);

  return {
    ...parsed,
    configPath: resolvedConfigPath,
    configDirectory: dirname(resolvedConfigPath),
  };
}
