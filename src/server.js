import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createArtifactReferenceValidator } from './artifacts/reference-validator.js';
import { loadConfig } from './config.js';
import { formatToolFailure, HarnessError } from './errors.js';
import { createSafeFileReader, createSensitivePathMatcher } from './filesystem/safe-reader.js';
import { createRepositoryService } from './repositories/repository-service.js';
import { createRedactor } from './redaction.js';
import { createEvidenceCatalog } from './session/evidence-catalog.js';
import { createSubprocessRunner } from './subprocess/runner.js';
import { createToolkitService } from './toolkit/toolkit-service.js';
import * as z from 'zod/v4';

function createMetricsRecorder() {
  let toolCallCount = 0;
  let returnedBytes = 0;

  return {
    record(structuredContent) {
      toolCallCount += 1;
      returnedBytes += Buffer.byteLength(JSON.stringify(structuredContent));
      return {
        toolCallCount,
        returnedBytes,
      };
    },
  };
}

function toToolResult(structuredContent) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function createFailureResult(error) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: false, error: formatToolFailure(error) }, null, 2),
      },
    ],
    structuredContent: {
      ok: false,
      error: formatToolFailure(error),
    },
    isError: true,
  };
}

export async function createHarnessServer({ configPath, env = process.env, runner = createSubprocessRunner() } = {}) {
  const config = await loadConfig({
    configPath: configPath ?? env.MODERNIZATION_EVIDENCE_HARNESS_CONFIG,
  });

  const redactor = createRedactor({ secrets: config.redaction.secrets });
  const fileReader = createSafeFileReader({
    redactor,
    sensitivePathMatcher: createSensitivePathMatcher(),
  });
  const evidenceCatalog = createEvidenceCatalog();
  const metrics = createMetricsRecorder();
  const repositoryService = createRepositoryService({
    repositories: config.repositories,
    runner,
    fileReader,
    redactor,
    limits: config.limits,
  });
  await repositoryService.initialize();
  const toolkitService = await createToolkitService({
    toolkitRootPath: config.toolkit?.rootPath,
    toolkitIndexPath: config.toolkit?.indexPath,
  });
  const artifactValidator = createArtifactReferenceValidator({
    artifactsRootPath: config.artifacts.rootPath,
    evidenceCatalog,
    toolkitService,
  });

  const server = new McpServer({
    name: 'modernization-evidence-harness',
    version: '0.1.0',
  });

  function withEnvelope(payload) {
    const sessionMetrics = metrics.record(payload);
    return {
      ok: true,
      ...payload,
      sessionMetrics,
    };
  }

  server.registerTool(
    'inventory_solution',
    {
      description:
        'Inventory one approved legacy repository using committed tracked files only. Returns bounded lexical inventory metadata, not semantic analysis.',
      inputSchema: {
        repositoryAlias: z.enum(['legacy-a', 'legacy-b']),
      },
    },
    async ({ repositoryAlias }, extra) => {
      try {
        const result = await repositoryService.inventorySolution({
          repositoryAlias,
          signal: extra.signal,
        });
        return toToolResult(
          withEnvelope({
            tool: 'inventory_solution',
            repositoryAlias,
            snapshot: repositoryService.listSnapshots()[repositoryAlias],
            inventory: {
              solutionFiles: result.solutionFiles,
              visiblePaths: result.visiblePaths,
              omittedPathCount: result.omittedPathCount,
              countsByExtension: result.countsByExtension,
            },
            limits: {
              maxVisiblePaths: config.limits.maxInventoryFiles,
            },
            measurements: {
              elapsedMs: result.elapsedMs,
            },
            limitations: result.limitations,
          })
        );
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );

  server.registerTool(
    'search_repository',
    {
      description:
        'Run a fixed-string ripgrep search against one approved legacy repository and return bounded lexical candidate evidence.',
      inputSchema: {
        repositoryAlias: z.enum(['legacy-a', 'legacy-b']),
        query: z.string().min(1).max(200),
      },
    },
    async ({ repositoryAlias, query }, extra) => {
      try {
        const result = await repositoryService.searchRepository({
          repositoryAlias,
          query,
          signal: extra.signal,
        });
        evidenceCatalog.recordAll(result.evidenceItems);
        return toToolResult(
          withEnvelope({
            tool: 'search_repository',
            repositoryAlias,
            snapshot: repositoryService.listSnapshots()[repositoryAlias],
            reportedQuery: result.reportedQuery,
            evidenceItems: result.evidenceItems,
            measurements: {
              elapsedMs: result.elapsedMs,
              evidenceCount: result.evidenceItems.length,
              omittedResults: Math.max(0, result.evidenceItems.length - config.limits.maxSearchMatches),
            },
            limitations: result.limitations,
          })
        );
      } catch (error) {
        if (error instanceof HarnessError && error.code === 'E_EXECUTABLE_NOT_FOUND') {
          error.message = 'ripgrep (rg) is required for search_repository. Install ripgrep and retry.';
        }
        return createFailureResult(error);
      }
    }
  );

  server.registerTool(
    'read_source_excerpt',
    {
      description:
        'Read a bounded excerpt from one approved legacy repository and return direct source observation evidence.',
      inputSchema: {
        repositoryAlias: z.enum(['legacy-a', 'legacy-b']),
        relativePath: z.string().min(1).max(260),
        lineStart: z.number().int().positive(),
        lineCount: z.number().int().positive().max(config.limits.maxExcerptLines),
      },
    },
    async ({ repositoryAlias, relativePath, lineStart, lineCount }, extra) => {
      try {
        const result = await repositoryService.readSourceExcerpt({
          repositoryAlias,
          relativePath,
          lineStart,
          lineCount,
          signal: extra.signal,
        });
        evidenceCatalog.recordAll(result.evidenceItems);
        return toToolResult(
          withEnvelope({
            tool: 'read_source_excerpt',
            repositoryAlias,
            snapshot: repositoryService.listSnapshots()[repositoryAlias],
            evidenceItems: result.evidenceItems,
            measurements: {
              elapsedMs: result.elapsedMs,
              evidenceCount: result.evidenceItems.length,
            },
            limitations: result.limitations,
          })
        );
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );

  server.registerTool(
    'validate_artifact_references',
    {
      description:
        'Validate artifact evidence references against the current session catalog and validate Toolkit references against the configured Toolkit index.',
      inputSchema: {
        artifactRelativePath: z.string().min(1).max(260),
        manifestRelativePath: z.string().min(1).max(260),
      },
    },
    async ({ artifactRelativePath, manifestRelativePath }) => {
      try {
        const result = await artifactValidator.validateArtifactReferences({
          artifactRelativePath,
          manifestRelativePath,
        });
        return toToolResult(
          withEnvelope({
            tool: 'validate_artifact_references',
            artifactRelativePath,
            manifestRelativePath,
            validation: result,
          })
        );
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );

  return {
    server,
    config,
    repositoryService,
  };
}
