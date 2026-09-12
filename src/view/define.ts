import type {
  CollectionSource,
  DocumentSelection,
  HasCompatibleFindOne,
  PopulateCollection,
  PopulateMap,
  ValidatePopulateMap,
  View,
  ViewFindOneOptions,
  ViewFindOptions,
  ViewPopulateOptions,
  ViewReadOptions,
} from '../types/core.ts'
import type { ViewDocument } from '../types/schema.ts'
import { getOrCompileViewPlan, viewPlanCache } from './plan.ts'
import { executePopulation } from '../populate/engine.ts'
import { resolveProvider, type ReadContext } from '../database/context.ts'

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
