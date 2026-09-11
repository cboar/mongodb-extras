import { PopulateUnresolvedError } from './errors.ts'
import { getPathTargets } from '../utils/path.ts'
import { toKeyString } from '../utils/common.ts'
import type { CompiledRelation } from '../view/plan.ts'

export interface LevelWorkItem {
  readonly document: unknown
  readonly relations: readonly CompiledRelation[]
}

export interface ReferenceTarget {
  readonly parent: Record<string, unknown>
  readonly key: string
  readonly isArray: boolean
  readonly rawValues: readonly unknown[]
  readonly lookupKeys: readonly (string | null)[]
  readonly relation: CompiledRelation
}

export function collectReferenceTargets(work: readonly LevelWorkItem[]): ReferenceTarget[] {
  const targets: ReferenceTarget[] = []

  for (const { document, relations } of work) {
    for (const relation of relations) {
      for (const { parent, key, value } of getPathTargets(document, relation.segments)) {
        const isArray = Array.isArray(value)

        if (isArray) {
          if (value.length === 0) continue
          if (value.every((val) => val == null)) {
            parent[key] = relation.onUnresolved === 'filter' ? [] : value.map(() => null)
            continue
          }
        } else if (value == null) {
          continue
        }

        const rawValues = isArray ? value : [value]
        targets.push({
          parent,
          key,
          isArray,
          rawValues,
          lookupKeys: rawValues.map(toKeyString),
          relation,
        })
      }
    }
  }

  return targets
}

function unresolved(
  relation: CompiledRelation,
  reason: PopulateUnresolvedError['reason'],
  index?: number,
): null {
  if (relation.onUnresolved === 'throw') {
    throw new PopulateUnresolvedError({
      path: relation.path,
      foreignKey: relation.foreignKey,
      reason,
      index,
    })
  }
  return null
}

function writeArray(
  values: readonly unknown[],
  relation: CompiledRelation,
  resolve: (value: unknown, index: number) => unknown,
): unknown[] {
  if (relation.onUnresolved !== 'filter') return values.map(resolve)

  const populated: unknown[] = []
  values.forEach((value, index) => {
    const document = resolve(value, index)
    if (document != null) populated.push(document)
  })
  return populated
}

export function writeTarget(target: ReferenceTarget, resolveKey: (key: string) => unknown): void {
  const resolve = (value: unknown, index: number): unknown => {
    if (value == null) return null
    const key = target.lookupKeys[index]
    const errorIndex = target.isArray ? index : undefined
    if (key == null) return unresolved(target.relation, 'unkeyable', errorIndex)
    return resolveKey(key) ?? unresolved(target.relation, 'not-found', errorIndex)
  }
  target.parent[target.key] = target.isArray
    ? writeArray(target.rawValues, target.relation, resolve)
    : resolve(target.rawValues[0], 0)
}
