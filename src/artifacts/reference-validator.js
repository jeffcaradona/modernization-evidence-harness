import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import * as z from 'zod/v4';
import { HarnessError } from '../errors.js';
import { normalizeRelativePath } from '../filesystem/safe-reader.js';

const artifactLifecycleStatusSchema = z.enum(['candidate', 'approved', 'pending']);

const manifestSchema = z.object({
  artifactId: z.string().min(1),
  artifactType: z.enum(['inventory', 'workflow', 'requirement', 'decision', 'design', 'open-question']),
  artifactStatus: artifactLifecycleStatusSchema.optional(),
  status: artifactLifecycleStatusSchema.optional(),
  departmentApproval: z.object({
    status: z.enum(['not-requested', 'pending', 'approved']).default('not-requested'),
    approvedBy: z.string().min(1).optional(),
    approvedAt: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  }).default({ status: 'not-requested' }),
  evidenceReferences: z.array(
    z.object({
      evidenceId: z.string().min(1),
      expectedSourceHash: z.string().min(1),
    })
  ).default([]),
  toolkitReferences: z.array(
    z.object({
      documentPath: z.string().min(1),
      referenceId: z.string().min(1),
      expectedDocumentHash: z.string().min(1),
    })
  ).default([]),
  traceability: z.array(
    z.object({
      observedBehavior: z.string().optional(),
      requirementId: z.string().optional(),
      acceptanceScenarioId: z.string().optional(),
      decisionId: z.string().optional(),
      toolkitReferenceId: z.string().optional(),
    })
  ).default([]),
}).superRefine((value, context) => {
  if (value.artifactStatus && value.status && value.artifactStatus !== value.status) {
    context.addIssue({
      code: 'custom',
      message: 'artifactStatus and status must match when both are present.',
      path: ['artifactStatus'],
    });
  }
}).transform((value) => ({
  ...value,
  artifactStatus: value.artifactStatus ?? value.status ?? 'candidate',
}));

export function createArtifactReferenceValidator({ artifactsRootPath, evidenceCatalog, toolkitService }) {
  function resolveArtifactPath(relativeArtifactPath) {
    const absoluteArtifactPath = resolve(artifactsRootPath, relativeArtifactPath);
    const relativeToRoot = relative(resolve(artifactsRootPath), absoluteArtifactPath);
    const escapesRoot =
      relativeToRoot === '..' ||
      relativeToRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(relativeToRoot);
    if (escapesRoot) {
      throw new HarnessError(
        'E_ARTIFACT_PATH_INVALID',
        'Artifact paths must remain within the approved artifact root.',
        { relativeArtifactPath }
      );
    }
    return absoluteArtifactPath;
  }

  async function validateArtifactReferences({ artifactRelativePath, manifestRelativePath }) {
    const artifactPath = normalizeRelativePath(artifactRelativePath);
    const manifestPath = normalizeRelativePath(manifestRelativePath);
    const manifestText = await readFile(resolveArtifactPath(manifestPath), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') {
        throw new HarnessError('E_ARTIFACT_MANIFEST_NOT_FOUND', 'Artifact reference manifest does not exist.', {
          manifestRelativePath: manifestPath,
        });
      }
      throw error;
    });

    await readFile(resolveArtifactPath(artifactPath), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') {
        throw new HarnessError('E_ARTIFACT_NOT_FOUND', 'Artifact markdown file does not exist.', {
          artifactRelativePath: artifactPath,
        });
      }
      throw error;
    });

    const manifest = manifestSchema.parse(JSON.parse(manifestText));

    const evidenceChecks = manifest.evidenceReferences.map((reference) => {
      const entry = evidenceCatalog.get(reference.evidenceId);
      if (!entry) {
        return { ...reference, status: 'unknown' };
      }
      if (entry.sourceHash !== reference.expectedSourceHash) {
        return { ...reference, status: 'stale', observedSourceHash: entry.sourceHash };
      }
      return { ...reference, status: 'ok' };
    });

    const toolkitChecks = [];
    for (const reference of manifest.toolkitReferences) {
      const located = await toolkitService.findReference(reference.documentPath, reference.referenceId);
      if (!located) {
        toolkitChecks.push({ ...reference, status: 'unknown' });
        continue;
      }
      if (located.unreadable) {
        toolkitChecks.push({ ...reference, status: 'stale', observedDocumentHash: null });
        continue;
      }
      if (located.documentHash !== reference.expectedDocumentHash) {
        toolkitChecks.push({ ...reference, status: 'stale', observedDocumentHash: located.documentHash });
        continue;
      }
      toolkitChecks.push({ ...reference, status: 'ok', title: located.reference.title });
    }

    const toolkitPending = !toolkitService.getIndex();
    // Keep integrity, semantic truth, and department approval separate.
    // A clean reference graph only proves that citations resolve to recorded
    // evidence; it does not prove the interpretation is correct or approved.
    const referenceIntegrityStatus = toolkitPending
      ? 'pending'
      : evidenceChecks.every((item) => item.status === 'ok') &&
          toolkitChecks.every((item) => item.status === 'ok')
        ? 'verified'
        : 'invalid';

    return {
      artifactId: manifest.artifactId,
      artifactType: manifest.artifactType,
      artifactStatus: manifest.artifactStatus,
      referenceIntegrity: {
        status: referenceIntegrityStatus,
        valid: referenceIntegrityStatus === 'verified',
        evidenceChecks,
        toolkitChecks,
        toolkitPending,
        note:
          'Reference integrity only proves that cited evidence and Toolkit references resolve to the recorded sources for this session.',
      },
      semanticCorrectness: {
        status: 'unverified',
        note:
          'The harness does not determine whether an interpretation, requirement, or design is semantically correct.',
      },
      departmentApproval: {
        claim: {
          status: manifest.departmentApproval.status,
          approvedBy: manifest.departmentApproval.approvedBy ?? null,
          approvedAt: manifest.departmentApproval.approvedAt ?? null,
          note:
            manifest.departmentApproval.note ??
            'This approval claim came from an untrusted manifest and is recorded as a claim only.',
        },
        verification: {
          status: 'unverified',
          source: null,
          note:
            'Milestone one has no trusted department-controlled approval source, so validation never upgrades a manifest claim into verified approval.',
        },
      },
      limitations: [
        'Validation proves that recorded references exist in the session catalog or Toolkit index.',
        'Validation cannot prove that an interpretation or requirement is correct.',
        'Validation never manufactures or verifies department approval from a model-writable manifest alone.',
      ],
    };
  }

  return {
    validateArtifactReferences,
  };
}
