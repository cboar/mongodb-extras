export interface TargetRef {
  parent: Record<string, any>
  key: string
  value: unknown
}

export function getPathTargets(root: unknown, path: string | readonly string[]): TargetRef[] {
  const segments = typeof path === 'string' ? path.split('.') : path
  const results: TargetRef[] = []

  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return results
  }

  function traverse(current: unknown, index: number): void {
    if (current == null) return

    if (Array.isArray(current)) {
      for (const item of current) traverse(item, index)
      return
    }

    if (typeof current !== 'object') return

    const segment = segments[index]
    if (segment === undefined) return
    const document = current as Record<string, unknown>

    if (index === segments.length - 1) {
      if (Object.hasOwn(document, segment) && document[segment] != null) {
        results.push({ parent: document, key: segment, value: document[segment] })
      }
      return
    }

    traverse(document[segment], index + 1)
  }

  traverse(root, 0)
  return results
}

export function getValuesAtPath(root: unknown, path: string | readonly string[]): unknown[] {
  const values: unknown[] = []

  function append(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) append(item)
      return
    }

    if (value != null) values.push(value)
  }

  for (const target of getPathTargets(root, path)) append(target.value)
  return values
}

export function prefixKeys<const P extends string, const T extends Record<string, unknown>>(
  prefix: P,
  entries: T,
): { [K in keyof T as `${P}.${string & K}`]: T[K] } {
  if (!prefix || prefix.startsWith('.') || prefix.endsWith('.') || prefix.includes('..')) {
    throw new TypeError(`Invalid prefix: "${prefix}"`)
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entries)) {
    result[`${prefix}.${key}`] = value
  }
  return result as { [K in keyof T as `${P}.${string & K}`]: T[K] }
}
