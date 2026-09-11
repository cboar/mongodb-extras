import { BSON } from 'mongodb'

export function toKeyString(value: unknown): string | null {
  if (value == null) return null
  const serialized = BSON.EJSON.stringify(value, { relaxed: false })
  return typeof serialized === 'string' ? serialized : null
}

export function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}
