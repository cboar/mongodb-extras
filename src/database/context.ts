import type { CollectionProvider, CollectionSource, PopulateCollection } from '../types/core.ts'
import { getOrCreate } from '../utils/common.ts'

export interface ReadContext {
  providerCache: Map<CollectionProvider, Promise<PopulateCollection>>
}

export async function resolveProvider(
  source: CollectionSource,
  context: ReadContext,
): Promise<PopulateCollection> {
  if (typeof source !== 'function') return source
  return getOrCreate(context.providerCache, source, async () => source())
}
