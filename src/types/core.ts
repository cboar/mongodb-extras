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

export type ViewFindOptions = Omit<FindOptions, 'projection' | 'explain' | 'raw' | 'returnKey'> & {
  projection?: never
  explain?: never
  raw?: never
  returnKey?: never
}

export type ViewFindOneOptions = Omit<
  FindOptions,
  | 'batchSize'
  | 'limit'
  | 'noCursorTimeout'
  | 'projection'
  | 'explain'
  | 'raw'
  | 'returnKey'
  | 'timeoutMode'
> & {
  batchSize?: never
  limit?: never
  noCursorTimeout?: never
  projection?: never
  explain?: never
  raw?: never
  returnKey?: never
  timeoutMode?: never
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

export interface View<TDoc = unknown, C extends CollectionSource = CollectionSource> {
  readonly collection: C
  read<R = TDoc>(
    loader: (
      collection: ResolvedCollection<C>,
      options: { projection: DocumentSelection | undefined },
    ) => R | Promise<R>,
  ): Promise<unknown extends TDoc ? Awaited<R> : MapLoaderResult<Awaited<R>, InferSchema<C>, TDoc>>
  find(filter?: SourceFilter<C>, options?: ViewFindOptions): Promise<TDoc[]>
  findOne(filter?: SourceFilter<C>, options?: ViewFindOneOptions): Promise<TDoc | null>
}

export interface ViewConfig<C extends CollectionSource = CollectionSource> {
  collection: C
  select?: DocumentSelection
  populate?: PopulateMap
}

export interface RelationConfig<
  C extends CollectionSource = CollectionSource,
> extends ViewConfig<C> {
  foreignKey?: string
}

type AnyView = View<unknown, any>

export type PopulateRelationEntry =
  | AnyView
  | RelationConfig
  | {
      view: AnyView | ViewConfig
      foreignKey?: string
    }

export type PopulateMap = Record<string, PopulateRelationEntry>

type ValidateViewConfig<V, ExtraKeys extends string = never> = V extends AnyView
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
      } & {
        [K in ExtraKeys]?: string
      } & {
        [K in Exclude<keyof V, 'collection' | 'select' | 'populate' | ExtraKeys>]: never
      }
    : AnyView | (ExtraKeys extends never ? ViewConfig : RelationConfig)

type ValidateRelationEntry<E> = E extends { view: unknown }
  ? {
      view: ValidateViewConfig<E['view']>
      foreignKey?: string
    } & {
      [K in Exclude<keyof E, 'view' | 'foreignKey'>]: never
    }
  : ValidateViewConfig<E, 'foreignKey'>

export type ValidatePopulateMap<P> = P extends undefined
  ? undefined
  : {
      [K in keyof P]: ValidateRelationEntry<P[K]>
    }
