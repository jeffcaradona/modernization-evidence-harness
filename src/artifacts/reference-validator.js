import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as z from 'zod/v4';
import { HarnessError } from '../errors.js';
import { normalizeRelativePath } from '../filesystem/safe-reader.js';

const manifestSchema = z.object({
  artifactId: z.string().min(1),
  artifactType: z.enum(['inventory', 'workflow', 'requirement', 'decision', 'design', 'open-question']),
  status: z.enum(['candidate', 'approved', 'pending']).default('candidate'),
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
});

export function createArtifactReferenceValidator({ artifactsRootPath, evidenceCatalog, toolkitService }) {
  async function validateArtifactReferences({ artifactRelativePath, manifestRelativePath }) {
    const artifactPath = normalizeRelativePath(artifactRelativePath);
    const manifestPath = normalizeRelativePath(manifestRelativePath);
    const manifestText = await readFile(resolve(artifactsRootPath, manifestPath), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') {
        throw new HarnessError('E_ARTIFACT_MANIFEST_NOT_FOUND', 'Artifact reference manifest does not exist.', {
          manifestRelativePath: manifestPath,
        });
      }
      throw error;
    });

    await readFile(resolve(artifactsRootPath, artifactPath), 'utf8').catch((error) => {
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
      if (located.documentHash !== reference.expectedDocumentHash) {
        toolkitChecks.push({ ...reference, status: 'stale', observedDocumentHash: located.documentHash });
        continue;
      }
      toolkitChecks.push({ ...reference, status: 'ok', title: located.reference.title });
    }

    const toolkitPending = !toolkitService.getIndex();

    return {
      artifactId: manifest.artifactId,
      artifactType: manifest.artifactType,
      status: manifest.status,
      valid: evidenceChecks.every((item) => item.status === 'ok') && toolkitChecks.every((item) => item.status === 'ok'),
      evidenceChecks,
      toolkitChecks,
      toolkitPending,
      limitations: [
        'Validation proves that recorded references exist in the session catalog or Toolkit index.',
        'Validation cannot prove that an interpretation or requirement is correct.',
      ],
    };
  }

  return {
    validateArtifactReferences,
  };
}
