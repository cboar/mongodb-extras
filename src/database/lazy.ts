import type { LazyDatabase } from '../types/core.ts'

export function lazyDatabase<T extends object>(getDb: () => T | Promise<T>): LazyDatabase<T> {
  const providers = new Map<PropertyKey, () => Promise<unknown>>()

  return new Proxy(Object.create(null) as LazyDatabase<T>, {
    get(_target, key) {
      if (key === 'then') return undefined
      let provider = providers.get(key)
      if (!provider) {
        provider = async () => (await getDb())[key as keyof T]
        providers.set(key, provider)
      }
      return provider
    },
  })
}
