import type { ReadContext } from '../database/context.ts'
import type { CompiledRelation } from '../view/plan.ts'
import { collectReferenceTargets, type LevelWorkItem } from './targets.ts'
import { groupQueryTargets, executeQueryGroup } from './query.ts'

export async function executePopulation(
  rootDocument: unknown,
  rootRelations: readonly CompiledRelation[],
  context: ReadContext,
): Promise<void> {
  let currentLevelWork: LevelWorkItem[] = [{ document: rootDocument, relations: rootRelations }]

  while (currentLevelWork.length > 0) {
    const targets = collectReferenceTargets(currentLevelWork)
    if (targets.length === 0) break

    const groups = await groupQueryTargets(targets, context)
    const nextLevelWork: LevelWorkItem[] = []

    await Promise.all(groups.map((group) => executeQueryGroup(group, nextLevelWork, context)))

    currentLevelWork = nextLevelWork
  }
}
