export { PopulateUnresolvedError } from './populate/errors.ts'
export { defineView } from './view/define.ts'
export { lazyDatabase } from './database/lazy.ts'
export { prefixKeys } from './utils/path.ts'

export type {
  CollectionSource,
  DocumentSelection,
  LazyDatabase,
  PopulateMap,
  PopulateUnresolvedPolicy,
  View,
  ViewConfig,
  ViewFindOneOptions,
  ViewFindOptions,
} from './types/core.ts'
export type { InferSchema, ViewDocument } from './types/schema.ts'
