export function cloneDocument<T>(document: T): T {
  if (Array.isArray(document)) {
    return document.map(cloneDocument) as T
  }

  if (document == null || typeof document !== 'object') {
    return document
  }

  const prototype = Object.getPrototypeOf(document)
  if (prototype !== Object.prototype && prototype !== null) {
    return document
  }

  const clone = Object.create(prototype) as Record<string, unknown>
  for (const [key, value] of Object.entries(document)) {
    clone[key] = cloneDocument(value)
  }
  return clone as T
}
