import type { PopulateCollection } from '../types/collection.ts'
import type { DocumentSelection, ViewFindByIdsOptions } from '../types/core.ts'
import { toIdKeyString } from '../utils/common.ts'

export async function findDocumentsByIds(
  collection: PopulateCollection,
  ids: readonly unknown[],
  projection?: DocumentSelection,
  options?: ViewFindByIdsOptions,
): Promise<Map<string | null, Record<string, unknown>>> {
  const omitId = projection?._id === 0
  if (omitId) {
    const selected = { ...projection }
    delete selected._id
    projection = selected
  }

  const results = await collection.find(
    { _id: { $in: ids } },
    { ...options, projection, collation: { locale: 'simple' } },
  ).toArray() as Record<string, unknown>[]

  const documents = new Map<string | null, Record<string, unknown>>()
  for (const document of results) {
    documents.set(toIdKeyString(document._id), document)
    if (omitId) delete document._id
  }
  return documents
}
