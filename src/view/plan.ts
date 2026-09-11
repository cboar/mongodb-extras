import type {
  CollectionSource,
  DocumentSelection,
  PopulateMap,
  PopulateRelationEntry,
  View,
  ViewConfig,
} from '../types/core.ts'
import { analyzeSelection, hasMatchingPrefix, isFieldRetainedInPlan } from './selection.ts'

export interface ViewPlan {
  readonly collection: CollectionSource
  readonly select?: DocumentSelection
  readonly selectionKey: string
  readonly isInclusive: boolean
  readonly relations: readonly CompiledRelation[]
}

export interface CompiledRelation {
  readonly path: string
  readonly segments: readonly string[]
  readonly targetView: ViewPlan
  readonly foreignKey: string
}

export interface NormalizedRelation {
  readonly targetView: ViewPlan
  readonly foreignKey: string
}

export const viewPlanCache = new WeakMap<object, ViewPlan>()

export function getViewPlan(value: unknown): ViewPlan | undefined {
  if (value && (typeof value === 'object' || typeof value === 'function')) {
    return viewPlanCache.get(value as object)
  }
  return undefined
}

const compiling = new Set<object>()

export function getOrCompileViewPlan(source: View | ViewConfig): ViewPlan {
  const cached = viewPlanCache.get(source)
  if (cached) return cached

  if (compiling.has(source)) {
    throw new TypeError('Circular reference detected during view plan compilation')
  }

  compiling.add(source)
  try {
    const select = 'select' in source ? source.select : undefined
    const populate = 'populate' in source ? source.populate : undefined
    const selectionAnalysis = analyzeSelection(select)
    const relations = populate ? compilePopulate(populate) : []

    let compiledSelect = select
    let compiledAnalysis = selectionAnalysis

    if (selectionAnalysis.isInclusive && populate) {
      let modified = false
      const effective: Record<string, 0 | 1> = { ...select }

      for (const path of Object.keys(populate)) {
        if (!hasMatchingPrefix(effective, path, 1) && !hasMatchingPrefix(effective, path, 0)) {
          for (const k of Object.keys(effective)) {
            if (k.startsWith(`${path}.`)) {
              delete effective[k]
            }
          }
          effective[path] = 1
          modified = true
        }
      }

      if (modified) {
        compiledSelect = Object.freeze(effective)
        compiledAnalysis = analyzeSelection(compiledSelect)
      }
    }

    const plan: ViewPlan = {
      collection: source.collection,
      select: compiledSelect,
      selectionKey: compiledAnalysis.selectionKey,
      isInclusive: compiledAnalysis.isInclusive,
      relations,
    }

    viewPlanCache.set(source, plan)
    return plan
  } finally {
    compiling.delete(source)
  }
}

export function normalizeRelation(rel: PopulateRelationEntry): NormalizedRelation {
  const foreignKey = ('foreignKey' in rel ? rel.foreignKey : undefined) ?? '_id'
  if (foreignKey.length === 0) {
    throw new TypeError('Relation "foreignKey" must be a non-empty string')
  }

  return {
    targetView: getOrCompileViewPlan('view' in rel ? rel.view : rel),
    foreignKey,
  }
}

export function compilePopulate(populateMap: PopulateMap): CompiledRelation[] {
  const entries: CompiledRelation[] = []
  const paths = Object.keys(populateMap)

  for (const path of paths) {
    if (!path || path.startsWith('.') || path.endsWith('.') || path.includes('..')) {
      throw new TypeError(`Invalid populate path: "${path}"`)
    }
  }

  for (let i = 0; i < paths.length; i++) {
    const p1 = paths[i]!
    for (let j = 0; j < paths.length; j++) {
      if (i === j) continue
      const p2 = paths[j]!
      if (p2.startsWith(`${p1}.`)) {
        throw new TypeError(
          `Conflicting populate paths: "${p1}" and "${p2}" cannot both be populated`,
        )
      }
    }
  }

  for (const [path, rel] of Object.entries(populateMap)) {
    const segments = path.split('.')
    const { targetView, foreignKey } = normalizeRelation(rel)

    if (!isFieldRetainedInPlan(targetView, foreignKey)) {
      throw new TypeError(
        `Relation at "${path}" matches on "${foreignKey}", which is excluded by the target view selection`,
      )
    }

    entries.push({ path, segments, targetView, foreignKey })
  }

  return entries
}
