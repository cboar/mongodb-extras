import type { PopulateCollection } from '../types/collection.ts'
import type { DocumentSelection } from '../types/core.ts'
import { cloneDocument } from '../utils/clone.ts'
import { getValuesAtPath } from '../utils/path.ts'
import { getOrCreate, toKeyString } from '../utils/common.ts'
import { resolveProvider, type ReadContext } from '../database/context.ts'
import { writeTarget, type LevelWorkItem, type ReferenceTarget } from './targets.ts'

export interface QueryGroup {
  readonly collection: PopulateCollection
  readonly foreignKey: string
  readonly projection?: DocumentSelection
  readonly filter?: Record<string, unknown>
  readonly targets: ReferenceTarget[]
  readonly keysToFetch: Map<string, unknown>
}

type FilterKey = string | Record<string, unknown>

function getFilterKey(filter: Record<string, unknown>): FilterKey {
  const entries = Object.entries(filter)
  for (const [field, value] of entries) {
    if (field.startsWith('$')) return filter
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      return filter
    }
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}

export async function groupQueryTargets(
  targets: readonly ReferenceTarget[],
  context: ReadContext,
): Promise<QueryGroup[]> {
  // Resolve unique providers concurrently
  const uniqueSources = Array.from(new Set(targets.map((t) => t.relation.targetView.collection)))
  const collections = await Promise.all(
    uniqueSources.map((source) => resolveProvider(source, context)),
  )
  const resolved = new Map(uniqueSources.map((source, i) => [source, collections[i]!]))

  // Flat scalar equality filters batch by value; complex filters use identity.
  const collectionMap = new Map<
    PopulateCollection,
    Map<string, Map<string, Map<FilterKey | undefined, QueryGroup>>>
  >()
  const filterKeys = new Map<Record<string, unknown>, FilterKey>()
  const groups: QueryGroup[] = []

  for (const target of targets) {
    const resolvedCollection = resolved.get(target.relation.targetView.collection)!

    const foreignKeyMap = getOrCreate(collectionMap, resolvedCollection, () => new Map())
    const selectionMap = getOrCreate(foreignKeyMap, target.relation.foreignKey, () => new Map())
    const filterMap = getOrCreate(selectionMap, target.relation.targetView.selectionKey, () => new Map())
    const { filter } = target.relation
    const filterKey = filter === undefined
      ? undefined
      : getOrCreate(filterKeys, filter, () => getFilterKey(filter))
    const group = getOrCreate(filterMap, filterKey, () => {
      const newGroup: QueryGroup = {
        collection: resolvedCollection,
        foreignKey: target.relation.foreignKey,
        projection: target.relation.targetView.select,
        filter: target.relation.filter,
        targets: [],
        keysToFetch: new Map(),
      }
      groups.push(newGroup)
      return newGroup
    })

    group.targets.push(target)

    for (let i = 0; i < target.lookupKeys.length; i++) {
      const k = target.lookupKeys[i]
      if (k != null && !group.keysToFetch.has(k)) {
        group.keysToFetch.set(k, target.rawValues[i])
      }
    }
  }

  return groups
}

export async function executeQueryGroup(
  group: QueryGroup,
  nextLevelWork: LevelWorkItem[],
  context: ReadContext,
): Promise<void> {
  const resultMap = new Map<string, unknown>()

  if (group.keysToFetch.size > 0) {
    const rawIds = Array.from(group.keysToFetch.values())
    const lookup = { [group.foreignKey]: { $in: rawIds } }
    const filter = group.filter === undefined ? lookup : { $and: [lookup, group.filter] }
    const options =
      group.projection || context.populateOptions
        ? { ...context.populateOptions, projection: group.projection }
        : undefined

    const results = await group.collection.find(filter, options).toArray()

    // Index raw documents by foreign key values
    for (const doc of results) {
      for (const val of getValuesAtPath(doc, group.foreignKey)) {
        const k = toKeyString(val)
        if (k != null && !resultMap.has(k)) {
          resultMap.set(k, doc)
        }
      }
    }
  }

  // Populate each destination: pass original on first assignment, clone on subsequent uses
  const assignedDocs = new Set<unknown>()

  for (const target of group.targets) {
    const { targetView } = target.relation

    writeTarget(target, (key) => {
      const rawDoc = resultMap.get(key)
      if (rawDoc == null) return null

      let doc: unknown
      if (assignedDocs.has(rawDoc)) {
        doc = cloneDocument(rawDoc)
      } else {
        assignedDocs.add(rawDoc)
        doc = rawDoc
      }

      if (targetView.relations.length > 0) {
        nextLevelWork.push({
          document: doc,
          relations: targetView.relations,
        })
      }
      return doc
    })
  }
}
