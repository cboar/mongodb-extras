import type { Collection, Document, Filter, FindOptions } from 'mongodb'
import type { InferSchema, MapLoaderResult } from './schema.ts'

export type DocumentSelection = Readonly<Record<string, 0 | 1>>

export interface PopulateCollection {
  readonly client?: object
  readonly namespace?: string
  find(filter: Record<string, unknown>, options?: FindOptions): { toArray(): Promise<unknown[]> }
  findOne(filter: Record<string, unknown>, options?: FindOptions): Promise<unknown>
}

export type CollectionProvider<C extends PopulateCollection = PopulateCollection> = () =>
  | C
  | Promise<C>

export type CollectionSource<C extends PopulateCollection = PopulateCollection> =
  | C
  | CollectionProvider<C>

export type ResolvedCollection<S extends CollectionSource> = S extends CollectionProvider
  ? Awaited<ReturnType<S>>
  : S

export type LazyDatabase<T extends object> = {
  [K in keyof T as K extends 'then' ? never : K]: () => Promise<Awaited<T[K]>>
}

export type SourceFilter<C extends CollectionSource> =
  ResolvedCollection<C> extends Collection<infer TSchema>
    ? Filter<TSchema>
    : InferSchema<C> extends Document
      ? Filter<InferSchema<C>>
      : Record<string, unknown>

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

type SourceId<C extends CollectionSource> = '_id' extends keyof InferSchema<C>
  ? InferSchema<C>['_id']
  : unknown

export type ViewFindOneOptions = WithoutOptions<
  FindOptions,
  | 'batchSize'
  | 'limit'
  | 'noCursorTimeout'
  | 'projection'
  | 'explain'
  | 'raw'
  | 'returnKey'
  | 'timeoutMode'
>

export type ViewPopulateOptions = Pick<FindOptions, 'session'>

export interface ViewReadOptions {
  populateOptions?: ViewPopulateOptions
}

type IsAny<T> = 0 extends 1 & T ? true : false

export type HasCompatibleFindOne<C extends CollectionSource> =
  IsAny<C> extends true
    ? true
    : ResolvedCollection<C> extends {
          findOne: (
            filter: SourceFilter<C>,
            options: Omit<ViewFindOneOptions, 'projection'> & {
              projection: DocumentSelection | undefined
            },
          ) => Promise<InferSchema<C> | null>
        }
      ? true
      : false

type ViewReadResult<R, C extends CollectionSource, TDoc> = unknown extends TDoc
  ? Awaited<R>
  : MapLoaderResult<Awaited<R>, InferSchema<C>, TDoc>

export interface View<out TDoc = unknown, C extends CollectionSource = CollectionSource> {
  readonly collection: C
  read<R = TDoc>(
    loader: (
      collection: ResolvedCollection<C>,
      options: { projection: DocumentSelection | undefined },
    ) => R | Promise<R>,
    options?: ViewReadOptions,
  ): Promise<ViewReadResult<R, C, TDoc>>
  find(filter?: SourceFilter<C>, options?: ViewFindOptions): Promise<TDoc[]>
  findByIds(ids: readonly SourceId<C>[], options?: ViewFindByIdsOptions): Promise<(TDoc | null)[]>
  findOne(filter?: SourceFilter<C>, options?: ViewFindOneOptions): Promise<TDoc | null>
}

export interface ViewConfig<C extends CollectionSource = CollectionSource> {
  collection: C
  select?: DocumentSelection
  populate?: PopulateMap
}

export type PopulateUnresolvedPolicy = 'null' | 'filter' | 'throw'

interface RelationOptions<C extends CollectionSource = CollectionSource> {
  foreignKey?: string
  onUnresolved?: PopulateUnresolvedPolicy
  filter?: SourceFilter<C>
}

export interface RelationConfig<C extends CollectionSource = CollectionSource>
  extends ViewConfig<C>, RelationOptions<C> {}

type AnyView = View<unknown, any>

export type PopulateRelationEntry =
  AnyView | RelationConfig | ({ view: AnyView | ViewConfig } & RelationOptions)

export type PopulateMap = Record<string, PopulateRelationEntry>

type ValidateViewConfig<V, Options extends object = {}> = V extends AnyView
  ? V
  : V extends { collection: unknown }
    ? {
        collection: V['collection'] extends CollectionSource
          ? HasCompatibleFindOne<V['collection']> extends true
            ? V['collection']
            : never
          : CollectionSource
        select?: DocumentSelection
        populate?: V extends { populate: infer SubP }
          ? [SubP] extends [PopulateMap]
            ? ValidatePopulateMap<SubP>
            : PopulateMap
          : PopulateMap
      } & Options & {
          [K in Exclude<keyof V, 'collection' | 'select' | 'populate' | keyof Options>]: never
        }
    : AnyView | (ViewConfig & Options)

type RelationSource<V> = V extends { collection: infer C extends CollectionSource }
  ? C
  : CollectionSource

type ValidateRelationEntry<E> = E extends { view: unknown }
  ? {
      view: ValidateViewConfig<E['view']>
    } & RelationOptions<RelationSource<E['view']>> & {
        [K in Exclude<keyof E, 'view' | keyof RelationOptions>]: never
      }
  : ValidateViewConfig<E, RelationOptions<RelationSource<E>>>

export type ValidatePopulateMap<P> = P extends undefined
  ? undefined
  : {
      [K in keyof P]: ValidateRelationEntry<P[K]>
    }
