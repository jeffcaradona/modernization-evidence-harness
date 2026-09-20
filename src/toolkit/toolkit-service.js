import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HarnessError } from '../errors.js';

export async function createToolkitService({ toolkitRootPath, toolkitIndexPath }) {
  if (!toolkitRootPath || !toolkitIndexPath) {
    return {
      getIndex() {
        return null;
      },
      findReference() {
        return null;
      },
    };
  }

  const indexText = await readFile(toolkitIndexPath, 'utf8');
  const index = JSON.parse(indexText);

  const documentsByPath = new Map();
  for (const document of index.documents ?? []) {
    documentsByPath.set(document.documentPath, document);
  }

  return {
    getIndex() {
      return index;
    },
    async findReference(documentPath, referenceId) {
      const document = documentsByPath.get(documentPath);
      if (!document) return null;
      const reference = (document.references ?? []).find((item) => item.referenceId === referenceId);
      if (!reference) return null;
      const documentBody = await readFile(new URL(documentPath, `${toolkitRootPath.endsWith('/') ? toolkitRootPath : `${toolkitRootPath}/`}`), 'utf8').catch(() => null);
      const documentHash = documentBody
        ? createHash('sha256').update(documentBody).digest('hex')
        : document.documentHash;
      return {
        documentPath,
        documentHash,
        reference,
      };
    },
    assertConfigured() {
      if (!index.documents?.length) {
        throw new HarnessError(
          'E_TOOLKIT_PENDING',
          'No department Toolkit index is configured. Mark Toolkit mappings as pending until guidance is supplied.'
        );
      }
    },
  };
}
