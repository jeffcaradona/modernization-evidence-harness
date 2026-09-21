export function createEvidenceCatalog() {
  const evidenceById = new Map();

  return {
    recordAll(evidenceItems) {
      for (const item of evidenceItems) {
        evidenceById.set(item.evidenceId, item);
      }
    },
    get(evidenceId) {
      return evidenceById.get(evidenceId) ?? null;
    },
    list() {
      return [...evidenceById.values()].sort((left, right) =>
        left.evidenceId.localeCompare(right.evidenceId)
      );
    },
  };
}
