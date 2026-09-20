import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtifactReferenceValidator } from '../src/artifacts/reference-validator.js';
import { createEvidenceCatalog } from '../src/session/evidence-catalog.js';
import { createToolkitService } from '../src/toolkit/toolkit-service.js';
import { createSessionWorkspace, writeArtifactFiles } from './helpers/repos.js';

test('reference validator accepts current evidence and toolkit references', async () => {
  const workspace = await createSessionWorkspace();
  const evidenceCatalog = createEvidenceCatalog();
  evidenceCatalog.recordAll([
    {
      evidenceId: 'ev_1',
      sourceHash: 'hash-1',
    },
  ]);
  const toolkitService = await createToolkitService({
    toolkitRootPath: workspace.toolkitPath,
    toolkitIndexPath: `${workspace.toolkitPath}/index.json`,
  });
  const validator = createArtifactReferenceValidator({
    artifactsRootPath: workspace.artifactsPath,
    evidenceCatalog,
    toolkitService,
  });

  await writeArtifactFiles(workspace.artifactsPath, {
    markdownRelativePath: 'requirements/order-submission.md',
    markdownBody: '# Candidate requirement\n',
    manifestRelativePath: 'requirements/order-submission.references.json',
    manifest: {
      artifactId: 'REQ-001',
      artifactType: 'requirement',
      status: 'candidate',
      evidenceReferences: [{ evidenceId: 'ev_1', expectedSourceHash: 'hash-1' }],
      toolkitReferences: [{ documentPath: 'department-toolkit.md', referenceId: 'TK-001', expectedDocumentHash: toolkitService.getIndex().documents[0].documentHash }],
      traceability: [{ requirementId: 'REQ-001', toolkitReferenceId: 'TK-001' }],
    },
  });

  const result = await validator.validateArtifactReferences({
    artifactRelativePath: 'requirements/order-submission.md',
    manifestRelativePath: 'requirements/order-submission.references.json',
  });

  assert.equal(result.valid, true);
  assert.equal(result.evidenceChecks[0].status, 'ok');
  assert.equal(result.toolkitChecks[0].status, 'ok');
});

test('reference validator reports stale and unknown references', async () => {
  const workspace = await createSessionWorkspace();
  const evidenceCatalog = createEvidenceCatalog();
  evidenceCatalog.recordAll([{ evidenceId: 'ev_1', sourceHash: 'hash-2' }]);
  const toolkitService = await createToolkitService({
    toolkitRootPath: workspace.toolkitPath,
    toolkitIndexPath: `${workspace.toolkitPath}/index.json`,
  });
  const validator = createArtifactReferenceValidator({
    artifactsRootPath: workspace.artifactsPath,
    evidenceCatalog,
    toolkitService,
  });

  await writeArtifactFiles(workspace.artifactsPath, {
    markdownRelativePath: 'requirements/order-submission.md',
    markdownBody: '# Candidate requirement\n',
    manifestRelativePath: 'requirements/order-submission.references.json',
    manifest: {
      artifactId: 'REQ-001',
      artifactType: 'requirement',
      status: 'candidate',
      evidenceReferences: [
        { evidenceId: 'ev_missing', expectedSourceHash: 'hash-x' },
        { evidenceId: 'ev_1', expectedSourceHash: 'hash-1' },
      ],
      toolkitReferences: [{ documentPath: 'department-toolkit.md', referenceId: 'TK-missing', expectedDocumentHash: 'hash' }],
    },
  });

  const result = await validator.validateArtifactReferences({
    artifactRelativePath: 'requirements/order-submission.md',
    manifestRelativePath: 'requirements/order-submission.references.json',
  });

  assert.equal(result.valid, false);
  assert.equal(result.evidenceChecks[0].status, 'unknown');
  assert.equal(result.evidenceChecks[1].status, 'stale');
  assert.equal(result.toolkitChecks[0].status, 'unknown');
});
