import type { Collection, Document, Filter, FindOptions } from 'mongodb'
import type { InferSchema } from './schema.ts'

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
