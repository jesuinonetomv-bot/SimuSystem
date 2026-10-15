// Catalog tombstones also suppress built-in and legacy diagram fallbacks.
export function activeDiagramCatalog(catalog = {}) {
  return Object.fromEntries(Object.entries(catalog || {}).filter(([, meta]) => meta && !meta.deletedAt));
}

function checkId(id) {
  if (typeof id !== "string" || !id || /[.#$\[\]/]/.test(id) || ["__proto__", "constructor", "prototype"].includes(id))
    throw new Error("Selecione uma aba válida.");
}

export function diagramDeletionUpdates({ id, metadata, draft, publication = null, publishedMetadata = null, deletedAt = Date.now(), defaultId = null, nextDefaultId = null }) {
  checkId(id);
  if (!metadata || metadata.deletedAt || !draft?.items || typeof draft.items !== "object")
    throw new Error("A aba não está disponível para exclusão.");
  if (!Number.isFinite(deletedAt) || deletedAt <= 0) throw new Error("Data de exclusão inválida.");
  const archive = structuredClone({ id, metadata, draft, publication, publishedMetadata, deletedAt });
  const marker = { id, deletedAt, operatorVisible: false };
  const updates = {
    ["engineering/diagramTrash/" + id]: archive,
    ["engineering/diagramCatalog/" + id]: { ...metadata, ...marker },
    ["published/catalog/" + id]: marker,
    ["engineering/diagrams/" + id + "/draft"]: null,
    ["published/diagrams/" + id]: null,
  };
  if (defaultId === id) updates["published/defaultDiagramId"] = nextDefaultId || null;
  return updates;
}

export function diagramRestorationUpdates(id, archive) {
  checkId(id);
  if (archive?.id !== id || !archive.metadata || !archive.draft || !archive.deletedAt)
    throw new Error("A cópia desta aba não está disponível na lixeira.");
  const metadata = { ...archive.metadata };
  delete metadata.deletedAt;
  const publishedMetadata = archive.publishedMetadata ? { ...archive.publishedMetadata } : null;
  if (publishedMetadata) delete publishedMetadata.deletedAt;
  return structuredClone({
    ["engineering/diagramCatalog/" + id]: metadata,
    ["engineering/diagrams/" + id + "/draft"]: archive.draft,
    ["published/catalog/" + id]: publishedMetadata,
    ["published/diagrams/" + id]: archive.publication || null,
    ["engineering/diagramTrash/" + id]: null,
  });
}
