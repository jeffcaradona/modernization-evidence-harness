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
      artifactStatus: 'candidate',
      departmentApproval: {
        status: 'pending',
      },
      evidenceReferences: [{ evidenceId: 'ev_1', expectedSourceHash: 'hash-1' }],
      toolkitReferences: [{ documentPath: 'department-toolkit.md', referenceId: 'TK-001', expectedDocumentHash: toolkitService.getIndex().documents[0].documentHash }],
      traceability: [{ requirementId: 'REQ-001', toolkitReferenceId: 'TK-001' }],
    },
  });

  const result = await validator.validateArtifactReferences({
    artifactRelativePath: 'requirements/order-submission.md',
    manifestRelativePath: 'requirements/order-submission.references.json',
  });

  assert.equal(result.referenceIntegrity.status, 'verified');
  assert.equal(result.referenceIntegrity.valid, true);
  assert.equal(result.referenceIntegrity.evidenceChecks[0].status, 'ok');
  assert.equal(result.referenceIntegrity.toolkitChecks[0].status, 'ok');
  assert.equal(result.artifactStatus, 'candidate');
  assert.equal(result.semanticCorrectness.status, 'unverified');
  assert.equal(result.departmentApproval.claim.status, 'pending');
  assert.equal(result.departmentApproval.verification.status, 'unverified');
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
      artifactStatus: 'candidate',
      departmentApproval: {
        status: 'not-requested',
      },
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

  assert.equal(result.referenceIntegrity.status, 'invalid');
  assert.equal(result.referenceIntegrity.valid, false);
  assert.equal(result.referenceIntegrity.evidenceChecks[0].status, 'unknown');
  assert.equal(result.referenceIntegrity.evidenceChecks[1].status, 'stale');
  assert.equal(result.referenceIntegrity.toolkitChecks[0].status, 'unknown');
  assert.equal(result.semanticCorrectness.status, 'unverified');
  assert.equal(result.departmentApproval.claim.status, 'not-requested');
  assert.equal(result.departmentApproval.verification.status, 'unverified');
});

test('reference validator does not verify department approval from a manifest claim', async () => {
  const workspace = await createSessionWorkspace();
  const evidenceCatalog = createEvidenceCatalog();
  evidenceCatalog.recordAll([{ evidenceId: 'ev_1', sourceHash: 'hash-1' }]);
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
    markdownRelativePath: 'requirements/claimed-approved.md',
    markdownBody: '# Claimed approved requirement\n',
    manifestRelativePath: 'requirements/claimed-approved.references.json',
    manifest: {
      artifactId: 'REQ-APPROVED-CLAIM',
      artifactType: 'requirement',
      artifactStatus: 'approved',
      departmentApproval: {
        status: 'approved',
        approvedBy: 'department-user',
        approvedAt: '2026-09-20',
      },
      evidenceReferences: [{ evidenceId: 'ev_1', expectedSourceHash: 'hash-1' }],
      toolkitReferences: [
        {
          documentPath: 'department-toolkit.md',
          referenceId: 'TK-001',
          expectedDocumentHash: toolkitService.getIndex().documents[0].documentHash,
        },
      ],
    },
  });

  const result = await validator.validateArtifactReferences({
    artifactRelativePath: 'requirements/claimed-approved.md',
    manifestRelativePath: 'requirements/claimed-approved.references.json',
  });

  assert.equal(result.artifactStatus, 'approved');
  assert.equal(result.referenceIntegrity.status, 'verified');
  assert.equal(result.departmentApproval.claim.status, 'approved');
  assert.equal(result.departmentApproval.verification.status, 'unverified');
  assert.equal(result.semanticCorrectness.status, 'unverified');
});
