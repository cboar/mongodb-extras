import type { Collection, WithId } from 'mongodb'
import type {
  CollectionSource,
  DocumentSelection,
  PopulateMap,
  PopulateUnresolvedPolicy,
  ResolvedCollection,
  View,
} from './core.ts'

type ResolvedCol<C> = ResolvedCollection<EnsureCollectionSource<C>>

type Flatten<T> = { [K in keyof T]: T[K] }

/**
 * Extracts the underlying document schema from a CollectionSource.
 * Accurately incorporates MongoDB's `WithId<TSchema>` behavior so `_id` is always present.
 */
export type InferSchema<C> =
  ResolvedCol<C> extends Collection<infer T>
    ? Flatten<WithId<T>>
    : ResolvedCol<C> extends {
          find(filter: any, options?: any): { toArray(): Promise<(infer T)[]> }
        }
      ? T
      : Record<string, unknown>

export type KeysWithValue<S, V> = keyof {
  [K in keyof S as S[K] extends V ? K : never]: 1
}

export type IncludedKeys<S> = KeysWithValue<S, 1>
export type ExcludedKeys<S> = KeysWithValue<S, 0>

export type IsInclusive<S> = [Exclude<IncludedKeys<S>, '_id'>] extends [never]
  ? [Exclude<ExcludedKeys<S>, '_id'>] extends [never]
    ? S extends { _id: 1 }
      ? true
      : false
    : false
  : true

export type SubKeys<S> = {
  [K in keyof S]: K extends `${infer Head}.${string}` ? Head : never
}[keyof S]

export type SubSelect<S, K extends string> = {
  [P in keyof S as P extends `${K}.${infer Rest}` ? Rest : never]: S[P]
}

export type DirectKeys<S, IsRoot extends boolean> =
  | IncludedKeys<S>
  | (IsRoot extends true
      ? S extends { _id: 0 }
        ? never
        : '_id' extends SubKeys<S>
          ? never
          : '_id'
      : never)

export type ApplyProjectionNested<TValue, SubS> = TValue extends undefined
  ? undefined
  : TValue extends null
    ? null
    : TValue extends (infer Item)[]
      ? ApplyProjectionNested<Item, SubS>[]
      : TValue extends readonly (infer Item)[]
        ? readonly ApplyProjectionNested<Item, SubS>[]
        : ApplyProjection<TValue, SubS, false>

/**
 * Applies projection (`select`) to a document schema `T`.
 * Handles inclusive selections (retaining `_id` unless `_id: 0` or subprojected) and exclusive selections.
 */
export type ApplyProjection<T, S, IsRoot extends boolean = true> = S extends undefined
  ? T
  : keyof S extends never
    ? T
    : string extends keyof S
      ? T
      : IsInclusive<S> extends true
        ? {
            [
              K in keyof T as K extends DirectKeys<S, IsRoot> | SubKeys<S> ? K : never
            ]: K extends DirectKeys<S, IsRoot>
              ? T[K]
              : K extends string
                ? ApplyProjectionNested<T[K], SubSelect<S, K>>
                : T[K]
          }
        : {
            [K in keyof T as K extends ExcludedKeys<S> ? never : K]: K extends SubKeys<S>
              ? K extends string
                ? ApplyProjectionNested<T[K], SubSelect<S, K>>
                : T[K]
              : T[K]
          }

type EnsureCollectionSource<C> = C extends CollectionSource ? C : CollectionSource

export type TargetDocFromConfig<V> =
  V extends View<infer TDoc, any>
    ? TDoc
    : V extends { collection: infer C }
      ? ViewDocument<
          EnsureCollectionSource<C>,
          V extends { select: infer S extends DocumentSelection } ? S : undefined,
          V extends { populate: infer P extends PopulateMap } ? P : undefined
        >
      : unknown

/**
 * Resolves the resulting document type from a populate relation entry.
 * Supports direct `View` instances, wrapped `{ view: ... }` objects, and inline relation configs.
 */
export type TargetDocFromEntry<E> = E extends { view: infer V }
  ? TargetDocFromConfig<V>
  : TargetDocFromConfig<E>

type UnresolvedPolicyOf<E> = E extends unknown
  ? 'onUnresolved' extends keyof E
    ? | Extract<E['onUnresolved'], PopulateUnresolvedPolicy>
      | (undefined extends E['onUnresolved'] ? 'null' : never)
    : 'null'
  : never

type ArrayNull<Item, P extends PopulateUnresolvedPolicy> = 'null' extends P
  ? null
  : 'throw' extends P
    ? null extends Item
      ? null
      : undefined extends Item
        ? null
        : never
    : never

/**
 * Transforms a relation leaf according to its unresolved policy, preserving source
 * scalar nullability and normalizing nullish array entries unless filtered.
 */
export type PopulateField<S, D, P extends PopulateUnresolvedPolicy = 'null'> = S extends undefined
  ? undefined
  : S extends null
    ? null
    : S extends (infer Item)[]
      ? (D | ArrayNull<Item, P>)[]
      : S extends readonly (infer Item)[]
        ? readonly (D | ArrayNull<Item, P>)[]
        : D | (P extends 'throw' ? never : null)

export type SubPopulate<P, K extends string> = {
  [SubKey in keyof P as SubKey extends `${K}.${infer Rest}` ? Rest : never]: P[SubKey]
}

export type HasSubPaths<P, K extends string> = keyof SubPopulate<P, K> extends never ? false : true

/**
 * Recursively applies a PopulateMap `P` to a document schema `T`.
 * Handles top-level fields and nested dot-notated paths through objects and arrays.
 */
export type ApplyPopulate<T, P> = P extends undefined
  ? T
  : keyof P extends never
    ? T
    : string extends keyof P
      ? T
      : {
          [K in keyof T]: K extends string
            ? K extends keyof P
              ? PopulateField<T[K], TargetDocFromEntry<P[K]>, UnresolvedPolicyOf<P[K]>>
              : HasSubPaths<P, K> extends true
                ? ApplyPopulateNested<T[K], SubPopulate<P, K>>
                : T[K]
            : T[K]
        }

export type ApplyPopulateNested<TValue, SubP> = TValue extends undefined
  ? undefined
  : TValue extends null
    ? null
    : TValue extends (infer Item)[]
      ? ApplyPopulateNested<Item, SubP>[]
      : TValue extends readonly (infer Item)[]
        ? readonly ApplyPopulateNested<Item, SubP>[]
        : ApplyPopulate<TValue, SubP>

type IsPathExcluded<Path extends string, S> = Path extends
  ExcludedKeys<S> | `${ExcludedKeys<S> & string}.${string}`
  ? true
  : false

export type PopulateKeysSelection<P, S> = P extends undefined
  ? {}
  : keyof P extends never
    ? {}
    : string extends keyof P
      ? {}
      : {
          [
            K in keyof P as K extends string
              ? IsPathExcluded<K, S> extends true
                ? never
                : K
              : never
          ]: 1
        }

/**
 * Computes the effective selection projection for a view.
 * When `S` is inclusive, any populated fields from `P` (whose path or ancestor
 * is not explicitly excluded in `S`) are implicitly added to the selection so they
 * are retained during projection and subsequently populated.
 * When `S` is not inclusive (omitted, empty, or exclusive), `S` is preserved as-is.
 */
export type EffectiveSelection<S, P> =
  IsInclusive<S> extends true
    ? [keyof PopulateKeysSelection<P, S>] extends [never]
      ? S
      : S & PopulateKeysSelection<P, S>
    : S

/**
 * Computes the final populated and projected document type for a view.
 */
export type ViewDocument<
  C extends CollectionSource = CollectionSource,
  S extends DocumentSelection | undefined = undefined,
  P extends PopulateMap | undefined = undefined,
> = ApplyPopulate<ApplyProjection<InferSchema<C>, EffectiveSelection<S, P>>, P>

type NonIdKeysOf<T> = Exclude<keyof T, '_id'>

type IsDocument<T, TBase> = [TBase] extends [never]
  ? false
  : unknown extends TBase
    ? false
    : T extends TBase
      ? true
      : [NonIdKeysOf<TBase>] extends [never]
        ? false
        : T extends Omit<TBase, '_id'>
          ? true
          : false

/**
 * Replaces base documents at the result root or within arrays and tuples with `TView`.
 * Other values, including object wrappers, are preserved because population only
 * traverses arrays before following the view's declared paths.
 */
export type MapLoaderResult<R, TBase, TView> = R extends null
  ? null
  : R extends undefined
    ? undefined
    : R extends readonly unknown[]
      ? { [K in keyof R]: MapLoaderResult<R[K], TBase, TView> }
      : R extends Function
        ? R
        : R extends object
          ? IsDocument<R, TBase> extends true
            ? TView
            : R
          : R
