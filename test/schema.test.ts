import assert from 'node:assert/strict'
import test from 'node:test'
import { defineView } from '../src/index.ts'
import { getDb, seedDatabase, type CourseDocument } from './shared.ts'

test('positive schema type fixtures define valid view plans', async () => {
  await import('./schema.types.ts')
})

test('loader tuples are populated while object wrappers retain their raw documents', async () => {
  const { courses, users } = await seedDatabase({
    courses: [{ _id: 71, title: 'Tuple Course', reviewer: 1 }],
  })
  const user = defineView({ collection: users, select: { name: 1 } })
  const course = defineView({
    collection: courses,
    select: { title: 1, reviewer: 1 },
    populate: { reviewer: user },
  })

  const tuple = await course.read(
    async (col, { projection }) => [await col.find({}, { projection }).toArray(), 100] as const,
  )
  assert.equal(tuple[0][0]?.reviewer?.name, 'Alice')
  assert.equal(tuple[1], 100)
  assert.equal(users.queryCount, 1)

  const wrapper = {
    items: await courses.find({}).toArray(),
    total: 1,
    createdAt: new Date(),
    format: () => 'Page 1',
  }
  const wrappedResult = await course.read(() => wrapper)
  assert.equal(wrappedResult, wrapper)
  assert.equal(wrappedResult.items[0]?.reviewer, 1)
  assert.equal(wrappedResult.createdAt.getTime(), wrapper.createdAt.getTime())
  assert.equal(wrappedResult.format(), 'Page 1')
  assert.equal(users.queryCount, 1)
})

test('loader documents without _id still populate optional references', async () => {
  const { courses, users } = await seedDatabase({
    courses: [
      { _id: 72, title: 'Reviewed', reviewer: 1 },
      { _id: 73, title: 'Unreviewed' },
    ],
  })
  const course = defineView({
    collection: courses,
    select: { _id: 0, title: 1, reviewer: 1 },
    populate: { reviewer: { collection: users, select: { name: 1 } } },
  })

  const result = await course.read((col, { projection }) =>
    col.find<Omit<CourseDocument, '_id'>>({}, { projection }).sort({ _id: 1 }).toArray(),
  )
  assert.equal(result[0]?.reviewer?.name, 'Alice')
  assert.deepEqual(result, [
    { title: 'Reviewed', reviewer: { _id: 1, name: 'Alice' } },
    { title: 'Unreviewed' },
  ])
})

test('projections distinguish root _id defaults from nested and composite ids', async () => {
  const { db } = await getDb()
  const collection = db.collection<{
    _id: { a: number; b: string }
    profile: { _id: string; name: string }
    matrix: { _id: string; a: number; b: string }[][]
  }>('schema_projections')
  const document = {
    _id: { a: 1, b: 'root' },
    profile: { _id: 'profile', name: 'Alice' },
    matrix: [[{ _id: 'cell', a: 2, b: 'hidden' }]],
  }
  await collection.insertOne(document)

  const nestedView = defineView({
    collection,
    select: { 'profile.name': 1, 'matrix.a': 1 },
  })
  const nested = await nestedView.read((col, { projection }) => col.findOne({}, { projection }))
  assert.deepEqual(nested, {
    _id: { a: 1, b: 'root' },
    profile: { name: 'Alice' },
    matrix: [[{ a: 2 }]],
  })

  const compositeView = defineView({ collection, select: { '_id.a': 1 } })
  const composite = await compositeView.read((col, { projection }) =>
    col.findOne({}, { projection }),
  )
  assert.deepEqual(composite, { _id: { a: 1 } })

  const excludedView = defineView({ collection, select: { '_id.b': 0, 'profile._id': 0 } })
  const excluded = await excludedView.read((col, { projection }) => col.findOne({}, { projection }))
  assert.deepEqual(excluded, {
    _id: { a: 1 },
    profile: { name: 'Alice' },
    matrix: document.matrix,
  })
})
