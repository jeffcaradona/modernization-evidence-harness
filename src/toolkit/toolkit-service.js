import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
      const documentBody = await readFile(
        resolve(toolkitRootPath, documentPath),
        'utf8'
      ).catch(() => null);
      if (documentBody === null) {
        return {
          documentPath,
          documentHash: null,
          reference,
          unreadable: true,
        };
      }
      const documentHash = createHash('sha256').update(documentBody).digest('hex');
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
