import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { HarnessError } from '../errors.js';

function escapesRoot(relativePath) {
  return (
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\')
  );
}

export function normalizeRelativePath(relativePath) {
  const normalized = String(relativePath ?? '').replaceAll('\\', '/');
  if (!normalized || normalized.includes('\0')) {
    throw new HarnessError('E_PATH_INVALID', 'Path must be a non-empty text value.');
  }
  if (normalized.startsWith('-')) {
    throw new HarnessError(
      'E_PATH_INVALID',
      'Path cannot start with a dash because trusted arguments must not become executable options.',
      { relativePath: normalized }
    );
  }
  if (normalized.split('/').some((part) => part === '.' || part === '')) {
    throw new HarnessError('E_PATH_INVALID', 'Path must not contain empty or current-directory segments.', {
      relativePath: normalized,
    });
  }
  if (normalized.split('/').includes('..')) {
    throw new HarnessError('E_PATH_INVALID', 'Path traversal is not allowed.', {
      relativePath: normalized,
    });
  }
  return normalized;
}

export function createSensitivePathMatcher() {
  const patterns = [
    /^\.git\//i,
    /(^|\/)\.env($|\.)/i,
    /(^|\/)secrets?(\.|$)/i,
    /(^|\/)appsettings\.[^/]+\.json$/i,
    /\.(snk|pfx|pem|key)$/i,
  ];

  return {
    isSensitive(relativePath) {
      const normalized = normalizeRelativePath(relativePath);
      return patterns.some((pattern) => pattern.test(normalized));
    },
  };
}

export function sliceLines(content, lineStart, lineCount) {
  if (!Number.isInteger(lineStart) || lineStart < 1) {
    throw new HarnessError('E_LINE_RANGE_INVALID', 'lineStart must be an integer greater than or equal to 1.');
  }
  if (!Number.isInteger(lineCount) || lineCount < 1) {
    throw new HarnessError('E_LINE_RANGE_INVALID', 'lineCount must be an integer greater than or equal to 1.');
  }

  const lines = content.split(/\r?\n/);
  const startIndex = lineStart - 1;
  if (startIndex >= lines.length) {
    throw new HarnessError('E_LINE_RANGE_INVALID', 'Requested line range is outside the file.', {
      lineStart,
      lineCount,
      fileLineCount: lines.length,
    });
  }

  const selected = lines.slice(startIndex, startIndex + lineCount);
  return {
    excerpt: selected.join('\n'),
    lineStart,
    lineEnd: lineStart + selected.length - 1,
    fileLineCount: lines.length,
    truncated: startIndex + lineCount < lines.length,
  };
}

export function createSafeFileReader({ redactor, sensitivePathMatcher }) {
  let canonicalRootCache = new Map();

  async function getCanonicalRoot(rootPath) {
    if (!canonicalRootCache.has(rootPath)) {
      canonicalRootCache.set(rootPath, realpath(resolve(rootPath)));
    }
    return canonicalRootCache.get(rootPath);
  }

  async function assertContained(rootPath, relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (sensitivePathMatcher.isSensitive(normalized)) {
      throw new HarnessError('E_SENSITIVE_PATH', 'Sensitive paths are excluded from collection.', {
        relativePath: normalized,
      });
    }

    const canonicalRoot = await getCanonicalRoot(rootPath);
    const candidatePath = resolve(canonicalRoot, normalized);
    const pathStat = await lstat(candidatePath).catch((error) => {
      if (error?.code === 'ENOENT') {
        throw new HarnessError('E_FILE_NOT_FOUND', 'Requested file does not exist.', {
          relativePath: normalized,
        });
      }
      throw error;
    });
    if (pathStat.isSymbolicLink()) {
      throw new HarnessError('E_SYMLINK_BLOCKED', 'Symlink paths are excluded from collection.', {
        relativePath: normalized,
      });
    }

    let canonicalTarget;
    try {
      canonicalTarget = await realpath(candidatePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new HarnessError('E_FILE_NOT_FOUND', 'Requested file does not exist.', {
          relativePath: normalized,
        });
      }
      throw error;
    }

    const relativeTarget = relative(canonicalRoot, canonicalTarget);
    if (escapesRoot(relativeTarget)) {
      throw new HarnessError('E_PATH_OUT_OF_ROOT', 'Path escapes the approved repository root.', {
        relativePath: normalized,
      });
    }

    return { canonicalRoot, canonicalTarget, normalized };
  }

  async function readBoundedText({ rootPath, relativePath, maxBytes, signal }) {
    if (signal?.aborted) {
      throw new HarnessError('E_ABORTED', 'Read cancelled before start.');
    }

    const contained = await assertContained(rootPath, relativePath);
    const file = await open(contained.canonicalTarget, 'r');

    try {
      const handleStat = await file.stat();
      const retainedBytes = Math.min(handleStat.size, maxBytes);
      const buffer = Buffer.alloc(retainedBytes);
      const { bytesRead } = await file.read(buffer, 0, retainedBytes, 0);
      const body = buffer.subarray(0, bytesRead);
      if (body.includes(0)) {
        throw new HarnessError('E_BINARY_FILE_REJECTED', 'Binary file content is not supported.', {
          relativePath: contained.normalized,
        });
      }

      const redactedContent = redactor.redact(body.toString('utf8'));
      return {
        relativePath: contained.normalized,
        content: redactedContent,
        retainedBytes: Buffer.byteLength(redactedContent),
        originalBytes: handleStat.size,
        truncated: handleStat.size > bytesRead,
        redaction: redactor.describe(),
      };
    } finally {
      await file.close();
    }
  }

  return {
    assertSafePath(rootPath, relativePath) {
      return assertContained(rootPath, relativePath);
    },
    readBoundedText,
  };
}
