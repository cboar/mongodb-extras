import assert from 'node:assert/strict'
import test from 'node:test'
import { ObjectId } from 'mongodb'
import { defineView } from '../src/index.ts'

function filteredView(filters: Array<Record<string, unknown> | undefined>) {
  const queries: Record<string, unknown>[] = []
  const collection = {
    find(filter: Record<string, unknown>) {
      queries.push(filter)
      return { toArray: async () => [] }
    },
    async findOne() { return null },
  }
  const view = defineView({
    collection,
    populate: Object.fromEntries(filters.map((filter, i) => [`ref${i}`, { collection, filter }])),
  })
  return {
    queries,
    read: () => view.read(() => Object.fromEntries(filters.map((_, i) => [`ref${i}`, 'id']))),
  }
}

test('flat scalar equality filters batch by value regardless of field order', async () => {
  const first = Object.freeze({ label: 'visible', count: 2, enabled: true, empty: null })
  const second = Object.freeze({ empty: null, enabled: true, count: 2, label: 'visible' })
  const { read, queries } = filteredView([first, second])
  await read()
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0], { $and: [{ _id: { $in: ['id'] } }, first] })
  assert.deepEqual(Object.keys(first), ['label', 'count', 'enabled', 'empty'])
})

test('flat filter keys preserve scalar types, values and field names', async () => {
  const filters = [
    { value: 1 }, { value: '1' }, { value: true }, { value: false },
    { value: 0 }, { value: null }, { value: 'null' }, { other: null },
    { value: NaN }, { value: Infinity }, { value: -Infinity }, { value: undefined },
  ]
  const { read, queries } = filteredView(filters)
  await read()
  assert.equal(queries.length, filters.length)
})

test('complex filters batch only by identity and unfiltered relations still share queries', async () => {
  const complex = [
    { value: { a: 1, b: 2 } }, { value: { b: 2, a: 1 } },
    { value: { a: 1, b: 2 } }, { value: [1, 2] }, { value: [1, 2] },
    { value: new ObjectId('650000000000000000000001') },
    { value: new ObjectId('650000000000000000000001') },
    { value: new Date(0) }, { value: new Date(0) },
    { value: /visible/i }, { value: /visible/i },
    { $comment: 'same' }, { $comment: 'same' },
  ]
  const { read, queries } = filteredView([...complex, ...complex, undefined, undefined])
  await read()
  assert.equal(queries.length, complex.length + 1)
})

test('flat filter keys are recomputed between reads after mutation', async () => {
  const first = { label: 'visible' }
  const second = { label: 'visible' }
  const { read, queries } = filteredView([first, second])
  await read()
  assert.equal(queries.length, 1)
  second.label = 'hidden'
  queries.length = 0
  await read()
  assert.equal(queries.length, 2)
})
