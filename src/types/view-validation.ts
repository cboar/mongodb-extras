import type { CollectionSource, ResolvedCollection, SourceFilter } from './collection.ts'
import type {
  AnyView,
  DocumentSelection,
  PopulateMap,
  RelationOptions,
  ViewConfig,
  ViewFindOneOptions,
} from './core.ts'
import type { InferSchema } from './schema.ts'

type IsAny<T> = 0 extends 1 & T ? true : false

/**
 * Views call the resolved collection's findOne with a filter and an options object
 * that always has a projection key. Its result must agree with the schema inferred
 * from the collection's find method so both view methods can promise the same document shape.
 */
export type ValidateFindOne<C extends CollectionSource> =
  IsAny<C> extends true
    ? C
    : ResolvedCollection<C> extends {
          findOne: (
            filter: SourceFilter<C>,
            options: Omit<ViewFindOneOptions, 'projection'> & {
              projection: DocumentSelection | undefined
            },
          ) => Promise<InferSchema<C> | null>
        }
      ? C
      : never

type ValidateViewConfig<V, Options extends object = {}> = V extends AnyView
  ? V
  : V extends { collection: unknown }
    ? {
        collection: V['collection'] extends CollectionSource
          ? ValidateFindOne<V['collection']>
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
