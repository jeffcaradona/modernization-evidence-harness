import { createHash } from 'node:crypto';

export const ANALYSIS_METHODS = {
  DIRECT_SOURCE_OBSERVATION: 'Direct source observation',
  LEXICAL_CANDIDATE: 'Lexical candidate',
};

export function createEvidenceRecord({
  repositoryAlias,
  commitSha,
  relativePath,
  lineStart,
  lineEnd,
  analysisMethod,
  sourceHash,
  excerpt,
  truncated,
  omissionReason = null,
  redaction,
}) {
  const identity = [
    repositoryAlias,
    commitSha,
    relativePath,
    lineStart,
    lineEnd,
    analysisMethod,
    sourceHash,
    excerpt,
  ].join(':');

  const evidenceId = `ev_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;

  return {
    evidenceId,
    repositoryAlias,
    commitSha,
    relativePath,
    lineRange: {
      start: lineStart,
      end: lineEnd,
    },
    analysisMethod,
    sourceHash,
    excerpt,
    truncation: {
      truncated,
      omissionReason,
    },
    redaction,
  };
}

export function compareEvidence(left, right) {
  return [left.repositoryAlias, left.relativePath, left.lineRange.start, left.lineRange.end, left.evidenceId]
    .join(':')
    .localeCompare(
      [right.repositoryAlias, right.relativePath, right.lineRange.start, right.lineRange.end, right.evidenceId].join(':')
    );
}
