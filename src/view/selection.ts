import type { DocumentSelection } from '../types/core.ts'
import type { ViewPlan } from './plan.ts'

export function analyzeSelection(select?: DocumentSelection) {
  const entries = Object.entries(select ?? {})
  if (entries.length === 0) {
    return { isInclusive: false, selectionKey: '' }
  }

  const hasNonIdInclusion = entries.some(([k, v]) => k !== '_id' && v === 1)
  const hasNonIdExclusion = entries.some(([k, v]) => k !== '_id' && v === 0)
  const hasOtherFields = hasNonIdInclusion || hasNonIdExclusion
  const isInclusive = hasNonIdInclusion || (!hasNonIdExclusion && select?._id === 1)

  // Explicit _id: 1 is redundant when other fields are present
  const canonical =
    hasOtherFields && select?._id === 1 ? entries.filter(([k]) => k !== '_id') : entries

  canonical.sort(([a], [b]) => a.localeCompare(b))
  return { isInclusive, selectionKey: JSON.stringify(canonical) }
}

export function hasMatchingPrefix(select: DocumentSelection, field: string, value: 0 | 1): boolean {
  if (select[field] === value) return true
  let lastDot = field.lastIndexOf('.')
  while (lastDot !== -1) {
    const prefix = field.slice(0, lastDot)
    if (select[prefix] === value) return true
    lastDot = prefix.lastIndexOf('.')
  }
  return false
}

export function isFieldRetainedInPlan(plan: ViewPlan, field: string): boolean {
  const select = plan.select
  if (select === undefined) return true
  // Subpath projections (e.g. key.b) partially project the field
  for (const k of Object.keys(select)) {
    if (k.startsWith(`${field}.`)) {
      return false
    }
  }
  // Reject if the field or an ancestor is explicitly excluded
  if (hasMatchingPrefix(select, field, 0)) {
    return false
  }
  if (plan.isInclusive) {
    if (hasMatchingPrefix(select, field, 1)) {
      return true
    }
    // MongoDB retains _id by default unless subprojected
    if (field === '_id' || field.startsWith('_id.')) {
      return !Object.keys(select).some((k) => k.startsWith('_id.'))
    }
    return false
  }
  return true
}
