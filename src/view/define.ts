import type {
  CollectionSource,
  DocumentSelection,
  HasCompatibleFindOne,
  PopulateCollection,
  PopulateMap,
  ValidatePopulateMap,
  View,
  ViewFindByIdsOptions,
  ViewFindOneOptions,
  ViewFindOptions,
  ViewPopulateOptions,
  ViewReadOptions,
} from '../types/core.ts'
import type { ViewDocument } from '../types/schema.ts'
import { getOrCompileViewPlan, viewPlanCache } from './plan.ts'
import { executePopulation } from '../populate/engine.ts'
import { resolveProvider, type ReadContext } from '../database/context.ts'
import { findDocumentsByIds } from '../database/find-by-ids.ts'
import { toIdKeyString } from '../utils/common.ts'

export function defineView<
  const C extends CollectionSource,
  const S extends DocumentSelection | undefined = undefined,
  const P extends PopulateMap | undefined = undefined,
>(config: {
  collection: C & (HasCompatibleFindOne<C> extends true ? unknown : never)
  select?: S
  populate?: P & ValidatePopulateMap<P>
}): View<ViewDocument<C, S, P>, C> {
  const plan = getOrCompileViewPlan(config)

  async function executeRead(
    loader: (
      collection: PopulateCollection,
      options: { projection: DocumentSelection | undefined },
    ) => unknown | Promise<unknown>,
    populateOptions?: ViewPopulateOptions,
  ): Promise<unknown> {
    const context: ReadContext = {
      providerCache: new Map(),
      populateOptions,
    }

    const rootCollection = await resolveProvider(plan.collection, context)
    const rootResult = await loader(rootCollection, {
      projection: plan.select,
    })

    if (rootResult == null) {
      return rootResult
    }

    if (typeof (rootResult as { toArray?: unknown }).toArray === 'function') {
      throw new TypeError('View loader must return materialized documents, not a cursor')
    }

    // Loader result ownership is transferred; mutate in place
    if (plan.relations.length > 0) {
      await executePopulation(rootResult, plan.relations, context)
    }

    return rootResult
  }

  const view = {
    collection: config.collection,
    read(
      loader: (
        collection: PopulateCollection,
        options: { projection: DocumentSelection | undefined },
      ) => unknown | Promise<unknown>,
      options?: ViewReadOptions,
    ): Promise<unknown> {
      return executeRead(loader, options?.populateOptions)
    },
    find(filter: Record<string, unknown> = {}, options?: ViewFindOptions): Promise<unknown> {
      return executeRead(
        (collection, { projection }) =>
          collection.find(filter, { ...options, projection }).toArray(),
        options?.session ? { session: options.session } : undefined,
      )
    },
    async findByIds(ids: readonly unknown[], options?: ViewFindByIdsOptions): Promise<unknown> {
      if (ids.length === 0) return []
      if (Object.keys(plan.select ?? {}).some((key) => key.startsWith('_id.'))) {
        throw new TypeError('findByIds does not support partial _id projections')
      }

      let documents = new Map<string | null, Record<string, unknown>>()
      await executeRead(
        async (collection, { projection }) => {
          documents = await findDocumentsByIds(collection, ids, projection, options)
          // Populate each document once, before expanding duplicate input IDs.
          return Array.from(documents.values())
        },
        options?.session ? { session: options.session } : undefined,
      )
      return ids.map((id) => documents.get(toIdKeyString(id)) ?? null)
    },
    findOne(filter: Record<string, unknown> = {}, options?: ViewFindOneOptions): Promise<unknown> {
      return executeRead(
        (collection, { projection }) => collection.findOne(filter, { ...options, projection }),
        options?.session ? { session: options.session } : undefined,
      )
    },
  }

  viewPlanCache.set(view, plan)

  return Object.freeze(view) as unknown as View<ViewDocument<C, S, P>, C>
}
