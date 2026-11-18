import assert from 'node:assert/strict'
import test from 'node:test'
import { Long, ObjectId, type Collection } from 'mongodb'
import { defineView, PopulateUnresolvedError, type DocumentSelection } from '../src/index.ts'
import { seedDatabase, testIds } from './shared.ts'

test('findByIds preserves order, duplicates and missing positions with one root query', async () => {
  const { users, courses } = await seedDatabase()
  const view = defineView({
    collection: () => courses,
    select: { title: 1 },
    populate: { reviewer: { collection: users, select: { name: 1 } } },
  })
  const { findByIds } = view
  const result = await findByIds([2, 999, 1, 2])
  assert.deepEqual(result.map((doc) => doc?._id ?? null), [2, null, 1, 2])
  assert.equal(result[0]?.reviewer?.name, 'Bob')
  assert.equal(result[2]?.reviewer?.name, 'Alice')
  assert.equal(courses.queryCount, 1)
  assert.equal(users.queryCount, 1)

  const objects = defineView({ collection: users })
  const objectResult = await objects.findByIds([
    new ObjectId(testIds.user2Id.toHexString()),
    testIds.user1Id,
    new ObjectId(testIds.user2Id.toHexString()),
  ])
  assert.deepEqual(objectResult.map((doc) => doc?.name), ['Bob', 'Alice', 'Bob'])
})

test('findByIds honors inclusive, exclusive and id-only exclusions without changing selections', async () => {
  const { tags } = await seedDatabase()
  const selections: DocumentSelection[] = [
    { _id: 0, label: 1 },
    { _id: 0, label: 0 },
    { _id: 0 },
  ]
  for (const select of selections) {
    const view = defineView({ collection: tags, select: Object.freeze(select) })
    const expected = await view.findOne({ _id: 2 })
    assert.deepEqual(await view.findByIds([2, 999, 2]), [expected, null, expected])
  }
})

test('findByIds indexes original ids before populating them', async () => {
  const { tags, users } = await seedDatabase()
  const view = defineView({
    collection: tags,
    populate: { _id: { collection: users, select: { name: 1 } } },
  })
  const result = await view.findByIds([2, 1, 2])
  assert.deepEqual(result.map((doc) => doc?._id?.name), ['Bob', 'Alice', 'Bob'])
  assert.equal(users.queryCount, 1)
})

test('findByIds matches BSON IDs across native numeric promotion settings', async () => {
  const { db } = await seedDatabase()
  const numeric = db.collection<{ _id: Long; name: string }>('numeric_ids')
  const composite = db.collection<{ _id: { value: Long }; name: string }>('composite_ids')
  const id = Long.fromNumber(42)
  const large = Long.fromString('9007199254740993')
  await numeric.insertMany([{ _id: id, name: 'small' }, { _id: large, name: 'large' }])
  await composite.insertOne({ _id: { value: id }, name: 'composite' })
  const view = defineView({ collection: numeric })
  for (const options of [undefined, { promoteLongs: false }, { useBigInt64: true }]) {
    const result = await view.findByIds([large, id, large], options)
    assert.deepEqual(result.map((doc) => doc?.name), ['large', 'small', 'large'])
  }
  const compositeView = defineView({ collection: composite })
  assert.equal((await compositeView.findByIds([{ value: id }]))[0]?.name, 'composite')
})

test('findByIds uses binary matching even with a collection default collation', async () => {
  const { db } = await seedDatabase()
  const collection = await db.createCollection<{ _id: string }>('collated_ids', {
    collation: { locale: 'en', strength: 2 },
  })
  await collection.insertOne({ _id: 'ABC' })
  assert.ok(await collection.findOne({ _id: 'abc' }))
  const view = defineView({ collection })
  assert.deepEqual(await view.findByIds(['abc', 'ABC']), [null, { _id: 'ABC' }])
})

test('findByIds skips empty input and rejects partial id projections before resolving providers', async () => {
  let calls = 0
  const view = defineView({
    collection: (): Collection<{ _id: number }> => {
      calls++
      throw new Error('provider must not run')
    },
    select: { '_id.part': 1 },
  })
  assert.deepEqual(await view.findByIds([]), [])
  await assert.rejects(view.findByIds([1]), /partial _id projections/)
  assert.equal(calls, 0)
})

test('populate filters use source fields and existing unresolved policies', async () => {
  const { courses, users } = await seedDatabase()
  const target = defineView({ collection: users, select: { name: 1 } })
  const base = { view: target, filter: { team: 100 } }
  const view = defineView({
    collection: courses,
    populate: {
      scalar: base,
      refs: { view: target, filter: { team: 100 }, onUnresolved: 'filter' },
      nullable: { view: target, filter: { team: 100 } },
    },
  })
  assert.deepEqual(
    await view.read(() => ({ scalar: 2, refs: [2, 1, null, 1], nullable: [2, 1] })),
    {
      scalar: null,
      refs: [{ _id: 1, name: 'Alice' }, { _id: 1, name: 'Alice' }],
      nullable: [null, { _id: 1, name: 'Alice' }],
    },
  )
  assert.equal(users.queryCount, 1)
  const strict = defineView({
    collection: courses,
    populate: { reviewer: { ...base, onUnresolved: 'throw' } },
  })
  await assert.rejects(strict.findOne({ _id: 2 }), PopulateUnresolvedError)
})

test('populate filters isolate query groups and intersect foreign-key conditions', async () => {
  const { courses, users } = await seedDatabase()
  const target = defineView({ collection: users, select: { name: 1 } })
  const view = defineView({
    collection: courses,
    populate: {
      active: { view: target, filter: { team: 100 } },
      excluded: { view: target, filter: { _id: { $ne: 1 } } },
      unfiltered: target,
    },
  })
  assert.deepEqual(await view.read(() => ({ active: 1, excluded: 1, unfiltered: 1 })), {
    active: { _id: 1, name: 'Alice' },
    excluded: null,
    unfiltered: { _id: 1, name: 'Alice' },
  })
  assert.equal(users.queryCount, 3)
})

test('inline and nested populate filters support custom foreign keys', async () => {
  const { courses, users, partners } = await seedDatabase()
  const view = defineView({
    collection: courses,
    populate: {
      'sections.author': {
        collection: users,
        filter: { name: 'Alice' },
        select: { name: 1 },
        populate: {
          team: { collection: partners, foreignKey: 'owner', filter: { name: 'Partner' } },
        },
      },
    },
  })
  const result: any = await view.read(() => ({ sections: [{ author: 1 }, { author: 2 }] }))
  assert.equal(result.sections[0].author.team.name, 'Partner')
  assert.equal(result.sections[1].author, null)
  assert.equal(users.queryCount, 1)
  assert.equal(partners.queryCount, 1)
})

test('findByIds retains native null and composite map ID matching', async () => {
  const { db } = await seedDatabase()
  const collection = db.collection<{ _id: Map<string, number> | null; name: string }>('map_ids')
  // A raw insert preserves the explicit null ID without driver ID generation.
  await db.command({
    insert: 'map_ids',
    documents: [
      { _id: null, name: 'null' },
      { _id: { value: 1 }, name: 'first' },
      { _id: { value: 2 }, name: 'second' },
    ],
  })
  const result = await defineView({ collection }).findByIds([
    new Map([['value', 2]]),
    null,
    new Map([['value', 1]]),
  ])
  assert.deepEqual(result.map((doc) => doc?.name), ['second', 'null', 'first'])
})
