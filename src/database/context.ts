import type {
  CollectionProvider,
  CollectionSource,
  PopulateCollection,
  ViewPopulateOptions,
} from '../types/core.ts'
import { getOrCreate } from '../utils/common.ts'

export interface ReadContext {
  providerCache: Map<CollectionProvider, Promise<PopulateCollection>>
  populateOptions?: ViewPopulateOptions
}

export async function resolveProvider(
  source: CollectionSource,
  context: ReadContext,
): Promise<PopulateCollection> {
  if (typeof source !== 'function') return source
  return getOrCreate(context.providerCache, source, async () => source())
}
