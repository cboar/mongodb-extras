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
            parent[key] = value.map(() => null)
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

export function writeTarget(
  target: ReferenceTarget,
  resolveKey: (key: string | null) => unknown,
): void {
  target.parent[target.key] = target.isArray
    ? target.lookupKeys.map(resolveKey)
    : resolveKey(target.lookupKeys[0] ?? null)
}
