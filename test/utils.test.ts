import assert from 'node:assert/strict'
import test from 'node:test'
import { ObjectId } from 'mongodb'
import { lazyDatabase } from '../src/database/lazy.ts'
import { toKeyString } from '../src/utils/common.ts'
import { cloneDocument } from '../src/utils/clone.ts'
import { getPathTargets, getValuesAtPath, prefixKeys } from '../src/utils/path.ts'

test('cloneDocument preserves primitives, atomics, and class instances by reference or value', () => {
  assert.equal(cloneDocument(null), null)
  assert.equal(cloneDocument(undefined), undefined)
  assert.equal(cloneDocument(123), 123)
  assert.equal(cloneDocument('string'), 'string')

  const date = new Date()
  assert.equal(cloneDocument(date), date)

  const id = new ObjectId()
  assert.equal(cloneDocument(id), id)

  const buf = Buffer.from('abc')
  assert.equal(cloneDocument(buf), buf)

  class CustomClass {
    public value = 42
  }
  const custom = new CustomClass()
  assert.equal(cloneDocument(custom), custom)
})

test('cloneDocument clones plain objects and preserves prototypes including null prototype', () => {
  const empty = {}
  const clonedEmpty = cloneDocument(empty)
  assert.notEqual(clonedEmpty, empty)
  assert.deepEqual(clonedEmpty, empty)

  const obj = { a: 1 }
  const clonedObj = cloneDocument(obj)
  assert.notEqual(clonedObj, obj)
  assert.deepEqual(clonedObj, obj)

  const nullObj = Object.create(null)
  nullObj.x = 10
  const clonedNull = cloneDocument(nullObj)
  assert.notEqual(clonedNull, nullObj)
  assert.deepEqual(clonedNull, nullObj)
  assert.equal(Object.getPrototypeOf(clonedNull), null)

  const protoObj = Object.create(Object.prototype)
  protoObj.y = 20
  const clonedProto = cloneDocument(protoObj)
  assert.notEqual(clonedProto, protoObj)
  assert.deepEqual(clonedProto, protoObj)
  assert.equal(Object.getPrototypeOf(clonedProto), Object.prototype)
})

test('cloneDocument deeply clones plain objects and arrays while preserving atomics', () => {
  const id = new ObjectId()
  const date = new Date(1000)
  const original = {
    str: 'hello',
    num: 42,
    id,
    date,
    arr: [{ x: 1 }, 2],
    nested: { y: 2 },
  }

  const cloned = cloneDocument(original)
  assert.notEqual(cloned, original)
  assert.deepEqual(cloned, original)
  assert.notEqual(cloned.arr, original.arr)
  assert.notEqual(cloned.arr[0], original.arr[0])
  assert.notEqual(cloned.nested, original.nested)
  assert.equal(cloned.id, id)
  assert.equal(cloned.date, date)
})

test('toKeyString canonicalizes BSON and primitives', () => {
  assert.equal(toKeyString(null), null)
  assert.equal(toKeyString(undefined), null)
  assert.equal(toKeyString('abc'), '"abc"')
  assert.equal(toKeyString(123), '{"$numberInt":"123"}')

  const id = new ObjectId('6a9c7cfdb5649d806cdd551e')
  const sameId = new ObjectId('6a9c7cfdb5649d806cdd551e')
  assert.equal(toKeyString(id), toKeyString(sameId))
})

test('prefixKeys helper prefixes keys for populate and select maps', () => {
  assert.deepEqual(prefixKeys('a', { b: 1, c: 2 }), { 'a.b': 1, 'a.c': 2 })
  assert.deepEqual(prefixKeys('a.b', { c: { d: 1 } }), { 'a.b.c': { d: 1 } })
  assert.throws(() => prefixKeys('', { a: 1 }), TypeError)
  assert.throws(() => prefixKeys('.a', { a: 1 }), TypeError)
  assert.throws(() => prefixKeys('a.', { a: 1 }), TypeError)
  assert.throws(() => prefixKeys('a..b', { a: 1 }), TypeError)
})

test('getPathTargets and getValuesAtPath extract values and targets across objects and arrays', () => {
  const doc = {
    user: { name: 'Alice' },
    tags: [{ id: 1 }, { id: 2 }],
    deep: [{ nested: [{ val: 10 }] }],
  }
  assert.deepEqual(getValuesAtPath(doc, 'user.name'), ['Alice'])
  assert.deepEqual(getValuesAtPath(doc, 'tags.id'), [1, 2])
  assert.deepEqual(getValuesAtPath(doc, 'deep.nested.val'), [10])
  assert.deepEqual(getValuesAtPath(doc, 'missing.field'), [])
  assert.deepEqual(getValuesAtPath(null, 'any'), [])
  assert.deepEqual(getValuesAtPath(doc, ''), [])

  const targets = getPathTargets(doc, 'user.name')
  assert.equal(targets.length, 1)
  assert.equal(targets[0]?.key, 'name')
  assert.equal(targets[0]?.value, 'Alice')
})

test('lazyDatabase proxies property access to cached lazy collection providers', async () => {
  let calls = 0
  const mockDb = {
    users: { name: 'users' },
    courses: { name: 'courses' },
  }
  const database = lazyDatabase(async () => {
    calls += 1
    return mockDb
  })

  assert.equal(calls, 0)
  assert.equal((database as any).then, undefined)

  const usersProvider = database.users
  assert.equal(usersProvider, database.users)
  assert.notEqual(database.users, database.courses)
  assert.equal(calls, 0)

  const resolvedUsers = await usersProvider()
  assert.equal(resolvedUsers, mockDb.users)
  assert.equal(calls, 1)

  const resolvedCourses = await database.courses()
  assert.equal(resolvedCourses, mockDb.courses)
  assert.equal(calls, 2)
})

test('lazyDatabase loader retries on the next call after a synchronous throw', async () => {
  let attempts = 0
  const database = lazyDatabase(() => {
    attempts += 1
    if (attempts === 1) throw new Error('connection failed')
    return { users: { name: 'users' } }
  })

  await assert.rejects(() => database.users(), /connection failed/)
  assert.equal(attempts, 1)

  const resolved = await database.users()
  assert.deepEqual(resolved, { name: 'users' })
  assert.equal(attempts, 2)
})
