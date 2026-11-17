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
  ViewFindByIdsOptions,
  ViewFindOneOptions,
  ViewFindOptions,
  ViewPopulateOptions,
  ViewReadOptions,
} from './types/core.ts'
export type { InferSchema, InferViewDocument, ViewDocument } from './types/schema.ts'
