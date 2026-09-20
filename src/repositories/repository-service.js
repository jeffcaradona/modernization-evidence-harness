import { HarnessError } from '../errors.js';
import { ANALYSIS_METHODS, compareEvidence, createEvidenceRecord } from '../evidence/evidence.js';
import {
  createSensitivePathMatcher,
  normalizeRelativePath,
  sliceLines,
} from '../filesystem/safe-reader.js';

function createGitPathSpec(revision, relativePath) {
  return `${revision}:${relativePath}`;
}

export function createRepositoryService({
  repositories,
  runner,
  fileReader,
  redactor,
  limits,
  clock = () => Date.now(),
  onAfterOperation,
}) {
  const snapshots = new Map();
  const sensitivePathMatcher = createSensitivePathMatcher();

  async function runGit(rootPath, args, signal) {
    return runner.run('git', args, {
      cwd: rootPath,
      signal,
      timeoutMs: limits.subprocessTimeoutMs,
      stdoutMaxBytes: limits.subprocessStdoutBytes,
      stderrMaxBytes: limits.subprocessStderrBytes,
      env: {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_PAGER: 'cat',
        GIT_OPTIONAL_LOCKS: '0',
        HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
      },
    });
  }

  async function requireSuccessfulGit(rootPath, args, signal, notFoundCode) {
    const result = await runGit(rootPath, args, signal);
    if (result.exitCode !== 0) {
      throw new HarnessError(notFoundCode ?? 'E_GIT_FAILED', 'Git operation failed.', {
        args,
        stderr: redactor.redact(result.stderr),
        exitCode: result.exitCode,
      });
    }
    return result.stdout.trim();
  }

  async function getHead(rootPath, signal) {
    return requireSuccessfulGit(rootPath, ['rev-parse', '--verify', 'HEAD'], signal, 'E_REVISION_UNAVAILABLE');
  }

  async function ensureClean(rootPath, signal) {
    const status = await requireSuccessfulGit(rootPath, ['status', '--porcelain', '--untracked-files=no'], signal);
    if (status) {
      throw new HarnessError('E_REPOSITORY_DIRTY', 'Milestone one only supports committed snapshots without tracked modifications.', {
        status: redactor.redact(status),
      });
    }
  }

  async function assertStableRevision(alias, signal) {
    const repo = repositories[alias];
    const snapshot = snapshots.get(alias);
    const currentHead = await getHead(repo.rootPath, signal);
    if (currentHead !== snapshot.commitSha) {
      throw new HarnessError('E_SOURCE_DRIFT', 'Repository revision changed after session initialization.', {
        repositoryAlias: alias,
        expectedCommitSha: snapshot.commitSha,
        observedCommitSha: currentHead,
      });
    }
    await ensureClean(repo.rootPath, signal);
  }

  async function withStableRevision(alias, signal, operation) {
    const repo = repositories[alias];
    if (!repo) {
      throw new HarnessError('E_UNKNOWN_REPOSITORY_ALIAS', 'Repository alias is not approved for this session.', {
        repositoryAlias: alias,
      });
    }

    await assertStableRevision(alias, signal);
    const startedAt = clock();
    const result = await operation({ ...repo, ...snapshots.get(alias) });
    if (onAfterOperation) {
      await onAfterOperation(alias);
    }
    await assertStableRevision(alias, signal);
    return {
      ...result,
      elapsedMs: clock() - startedAt,
      commitSha: snapshots.get(alias).commitSha,
    };
  }

  async function initialize(signal) {
    for (const [alias, repo] of Object.entries(repositories)) {
      await ensureClean(repo.rootPath, signal);
      const commitSha = await getHead(repo.rootPath, signal);
      snapshots.set(alias, {
        commitSha,
        initializedAt: new Date().toISOString(),
      });
    }
  }

  function filterVisiblePaths(relativePaths) {
    return relativePaths
      .map((item) => item.replaceAll('\\', '/'))
      .filter((item) => !item.startsWith('.git/'))
      .filter((item) => !item.includes('/bin/') && !item.includes('/obj/'))
      .filter((item) => !sensitivePathMatcher.isSensitive(item))
      .sort((left, right) => left.localeCompare(right));
  }

  async function inventorySolution({ repositoryAlias, signal }) {
    return withStableRevision(repositoryAlias, signal, async (repo) => {
      const stdout = await requireSuccessfulGit(
        repo.rootPath,
        ['ls-files', '-z'],
        signal,
        'E_INVENTORY_FAILED'
      );
      const trackedPaths = filterVisiblePaths(stdout.split('\0').filter(Boolean));
      const visiblePaths = trackedPaths.slice(0, limits.maxInventoryFiles);
      const countsByExtension = Object.create(null);
      for (const filePath of trackedPaths) {
        const extension = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase() : '[none]';
        countsByExtension[extension] = (countsByExtension[extension] ?? 0) + 1;
      }

      const solutionFiles = trackedPaths.filter((path) => /\.(sln|vbproj)$/i.test(path));
      return {
        repositoryAlias,
        visiblePaths,
        omittedPathCount: Math.max(0, trackedPaths.length - visiblePaths.length),
        solutionFiles,
        countsByExtension,
        limitations: [
          'Inventory is based on committed tracked files only.',
          'Inventory is lexical and does not build or execute the legacy application.',
        ],
      };
    });
  }

  async function getBlobHash(repo, relativePath, signal) {
    return requireSuccessfulGit(
      repo.rootPath,
      ['rev-parse', '--verify', createGitPathSpec(repo.commitSha, relativePath)],
      signal,
      'E_SOURCE_IDENTITY_UNAVAILABLE'
    );
  }

  async function readSourceExcerpt({ repositoryAlias, relativePath, lineStart, lineCount, signal }) {
    return withStableRevision(repositoryAlias, signal, async (repo) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      const boundedText = await fileReader.readBoundedText({
        rootPath: repo.rootPath,
        relativePath: normalizedPath,
        maxBytes: limits.maxExcerptBytes,
        signal,
      });
      const sliced = sliceLines(boundedText.content, lineStart, lineCount);
      const excerpt = sliced.excerpt;
      const sourceHash = await getBlobHash(repo, normalizedPath, signal);
      const evidence = createEvidenceRecord({
        repositoryAlias,
        commitSha: repo.commitSha,
        relativePath: normalizedPath,
        lineStart: sliced.lineStart,
        lineEnd: sliced.lineEnd,
        analysisMethod: ANALYSIS_METHODS.DIRECT_SOURCE_OBSERVATION,
        sourceHash,
        excerpt,
        truncated: sliced.truncated || boundedText.truncated,
        omissionReason:
          sliced.truncated || boundedText.truncated
            ? 'Requested source excerpt was bounded by configured line and byte limits.'
            : null,
        redaction: redactor.describe(),
      });
      return {
        repositoryAlias,
        evidenceItems: [evidence],
        fileLineCount: sliced.fileLineCount,
        limitations: [
          'Excerpt reads text only and rejects binary content.',
          'Source identity is tied to the pinned Git blob for the current session revision.',
        ],
      };
    });
  }

  async function searchRepository({ repositoryAlias, query, signal }) {
    return withStableRevision(repositoryAlias, signal, async (repo) => {
      const reportedQuery = redactor.redact(query);
      const result = await runner.run(
        'rg',
        [
          '--json',
          '--fixed-strings',
          '--hidden',
          '--glob',
          '!.git/**',
          '--glob',
          '!**/bin/**',
          '--glob',
          '!**/obj/**',
          '--max-count',
          String(limits.maxSearchMatches),
          '--max-filesize',
          String(limits.maxSearchFileBytes),
          '--color',
          'never',
          '--',
          query,
          repo.rootPath,
        ],
        {
          cwd: repo.rootPath,
          signal,
          timeoutMs: limits.subprocessTimeoutMs,
          stdoutMaxBytes: limits.subprocessStdoutBytes,
          stderrMaxBytes: limits.subprocessStderrBytes,
          env: {},
        }
      );

      if (result.exitCode === 1) {
        return {
          repositoryAlias,
          evidenceItems: [],
          reportedQuery,
          limitations: ['Fixed-string ripgrep search returned no matches.'],
        };
      }

      if (result.exitCode !== 0) {
        const code = result.exitCode === null ? 'E_SEARCH_FAILED' : 'E_SEARCH_FAILED';
        const details = {
          exitCode: result.exitCode,
          stderr: redactor.redact(result.stderr),
          reportedQuery,
        };
        if (result.stderrTruncated) {
          details.stderrTruncated = true;
        }
        if (result.exitCode === null) {
          details.termSignal = result.termSignal;
        }
        throw new HarnessError(code, 'Repository search failed.', details);
      }

      const evidenceItems = [];
      let omittedSensitiveMatches = 0;
      for (const line of result.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          if (result.stdoutTruncated) {
            break;
          }
          throw new HarnessError('E_SEARCH_OUTPUT_INVALID', 'Search output was malformed.', {
            line,
          });
        }
        if (entry.type !== 'match') continue;
        const rawPath = entry.data.path.text.replaceAll('\\', '/');
        const relativePath = normalizeRelativePath(
          rawPath.startsWith(repo.rootPath)
            ? rawPath.slice(repo.rootPath.length + 1)
            : rawPath
        );
        try {
          await fileReader.assertSafePath(repo.rootPath, relativePath);
        } catch (error) {
          if (error instanceof HarnessError && error.code === 'E_SENSITIVE_PATH') {
            omittedSensitiveMatches += 1;
            continue;
          }
          throw error;
        }
        const sourceHash = await getBlobHash(repo, relativePath, signal);
        const excerptBuffer = Buffer.from(
          redactor.redact(entry.data.lines.text.trimEnd()),
          'utf8'
        );
        const limitedExcerpt = excerptBuffer.subarray(0, limits.maxExcerptBytes);
        const evidence = createEvidenceRecord({
          repositoryAlias,
          commitSha: repo.commitSha,
          relativePath,
          lineStart: entry.data.line_number,
          lineEnd: entry.data.line_number,
          analysisMethod: ANALYSIS_METHODS.LEXICAL_CANDIDATE,
          sourceHash,
          excerpt: limitedExcerpt.toString('utf8'),
          truncated: limitedExcerpt.length < excerptBuffer.length,
          omissionReason:
            limitedExcerpt.length < excerptBuffer.length
              ? 'Search match excerpt exceeded the configured byte limit.'
              : null,
          redaction: redactor.describe(),
        });
        evidenceItems.push(evidence);
        if (evidenceItems.length >= limits.maxSearchMatches) {
          break;
        }
      }

      return {
        repositoryAlias,
        evidenceItems: evidenceItems.sort(compareEvidence),
        reportedQuery,
        omittedSensitiveMatches,
        limitations: [
          'Search uses fixed-string matching only and should be treated as a lexical candidate, not semantic proof.',
          'Late binding, generated code, and configuration can hide additional relationships.',
        ],
      };
    });
  }

  return {
    initialize,
    inventorySolution,
    readSourceExcerpt,
    searchRepository,
    listSnapshots() {
      return Object.fromEntries(snapshots.entries());
    },
  };
}
