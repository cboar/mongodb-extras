import type { FindOptions } from 'mongodb'
import type { CollectionSource, ResolvedCollection, SourceFilter } from './collection.ts'
import type { InferSchema, MapLoaderResult } from './schema.ts'

export type DocumentSelection = Readonly<Record<string, 0 | 1>>

export interface View<out TDoc = unknown, C extends CollectionSource = CollectionSource> {
  readonly collection: C
  /**
   * The loader receives the resolved collection and the view's effective projection.
   * Apply any supplied projection and return materialized results from the loader.
   * The view populates returned documents in place.
   */
  read<R = TDoc>(
    loader: (
      collection: ResolvedCollection<C>,
      options: { projection: DocumentSelection | undefined },
    ) => R | Promise<R>,
    options?: ViewReadOptions,
  ): Promise<ViewReadResult<R, C, TDoc>>
  find(filter?: SourceFilter<C>, options?: ViewFindOptions): Promise<TDoc[]>
  findOne(filter?: SourceFilter<C>, options?: ViewFindOneOptions): Promise<TDoc | null>
  /**
   * Returns one result per input ID, in input order.
   * Repeated IDs produce repeated results, and missing IDs yield `null`.
   */
  findByIds(ids: readonly SourceId<C>[], options?: ViewFindByIdsOptions): Promise<(TDoc | null)[]>
}

export interface ViewConfig<C extends CollectionSource = CollectionSource> {
  collection: C
  select?: DocumentSelection
  populate?: PopulateMap
}

export type PopulateUnresolvedPolicy = 'null' | 'filter' | 'throw'

export interface RelationOptions<C extends CollectionSource = CollectionSource> {
  foreignKey?: string
  /**
   * Defaults to `'null'`, which replaces unresolved references with `null`
   * and preserves array positions.
   */
  onUnresolved?: PopulateUnresolvedPolicy
  /**
   * Filters target documents before projection, so it can use fields omitted by the target view.
   * References with no matching target follow `onUnresolved`.
   */
  filter?: SourceFilter<C>
}

export interface RelationConfig<C extends CollectionSource = CollectionSource>
  extends ViewConfig<C>, RelationOptions<C> {}

export type AnyView = View<unknown, any>

export type PopulateRelationEntry =
  AnyView | RelationConfig | ({ view: AnyView | ViewConfig } & RelationOptions)

export type PopulateMap = Record<string, PopulateRelationEntry>

type WithoutOptions<T, K extends PropertyKey> = Omit<T, K> & {
  [P in K]?: never
}

export type ViewFindOptions = WithoutOptions<
  FindOptions,
  'projection' | 'explain' | 'raw' | 'returnKey'
>

export type ViewFindByIdsOptions = WithoutOptions<
  ViewFindOptions,
  'sort' | 'skip' | 'limit' | 'collation'
>

export type ViewFindOneOptions = WithoutOptions<
  ViewFindOptions,
  'batchSize' | 'limit' | 'noCursorTimeout' | 'timeoutMode'
>

export type ViewPopulateOptions = Pick<FindOptions, 'session'>

export interface ViewReadOptions {
  populateOptions?: ViewPopulateOptions
}

type SourceId<C extends CollectionSource> = '_id' extends keyof InferSchema<C>
  ? InferSchema<C>['_id']
  : unknown

type ViewReadResult<R, C extends CollectionSource, TDoc> = unknown extends TDoc
  ? Awaited<R>
  : MapLoaderResult<Awaited<R>, InferSchema<C>, TDoc>
