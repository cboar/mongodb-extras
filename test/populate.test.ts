import assert from 'node:assert/strict'
import test from 'node:test'
import { defineView } from '../src/index.ts'
import { db, getDb, seedDatabase, testIds } from './shared.ts'

test('reads projected native arrays once and groups sibling paths into a single query', async () => {
  const { partners, users, courses } = await seedDatabase()

  const userView = defineView({
    collection: users,
    select: { _id: 1, name: 1 },
  })

  const partnerView = defineView({
    collection: partners,
    select: { name: 1 },
  })

  const courseView = defineView({
    collection: courses,
    select: { _id: 1, title: 1, partner: 1, reviewer: 1, sections: 1 },
    populate: {
      partner: partnerView,
      reviewer: userView,
      'sections.author': userView,
    },
  })

  let loads = 0
  const result: any = await courseView.read((collection, { projection }) => {
    loads += 1
    return collection.find({ published: true }, { projection }).sort({ title: 1 }).toArray()
  })

  assert.equal(loads, 1)
  assert.equal(partners.queryCount, 1)
  // Both reviewer and sections.author target the same userView at the same depth,
  // so they share one query.
  assert.equal(users.queryCount, 1)
  const userQueryIds = (users.queries[0] as any)._id.$in
  assert.equal(userQueryIds.length, 2)
  assert.ok(userQueryIds.some((id: any) => id.equals(testIds.user1Id)))
  assert.ok(userQueryIds.some((id: any) => id.equals(testIds.user2Id)))

  assert.equal(result.length, 2)
  assert.equal(result[0].title, 'A')
  assert.deepEqual(result[0].partner, { _id: testIds.partner1Id, name: 'Partner Org' })
  assert.deepEqual(result[0].reviewer, { _id: testIds.user2Id, name: 'Bob' })
  assert.deepEqual(result[0].sections[0].author, { _id: testIds.user1Id, name: 'Alice' })

  assert.equal(result[1].title, 'B')
  assert.deepEqual(result[1].partner, { _id: testIds.partner1Id, name: 'Partner Org' })
  assert.deepEqual(result[1].reviewer, { _id: testIds.user1Id, name: 'Alice' })
  assert.deepEqual(result[1].sections[0].author, { _id: testIds.user2Id, name: 'Bob' })
  assert.deepEqual(result[1].sections[1].author, { _id: testIds.user1Id, name: 'Alice' })
})

test('views with identical projections batch together while nested relations remain destination-specific', async () => {
  const { users, partners, roots } = await seedDatabase()

  const partnerView = defineView({
    collection: partners,
    select: { name: 1 },
  })

  // Two views on same collection, same selection
  const authorView = defineView({
    collection: users,
    select: { name: 1, team: 1 },
    populate: { team: partnerView },
  })
  const editorView = defineView({
    collection: users,
    select: { name: 1, team: 1 },
  })

  const root = defineView({
    collection: roots,
    populate: {
      author: authorView,
      editor: editorView,
    },
  })

  const result: any = await root.read((col) => col.findOne({ _id: 1 }))

  // Both author and editor target users with the same projection, so they share one query.
  assert.equal(users.queryCount, 1)
  assert.deepEqual(users.queries[0], { _id: { $in: [1] } })

  // Both destinations reference the same ID (1), but their populated containers remain independent:
  assert.notEqual(result.author, result.editor)
  assert.equal(result.author.name, 'Alice')
  assert.equal(result.editor.name, 'Alice')
  assert.equal(result.author.team, null) // team was looked up in partners
  assert.equal(result.editor.team, 100) // team remained as raw foreign key value
})

test('views with implied and explicit _id: 1 batch together into a single query', async () => {
  const { users, roots } = await seedDatabase({
    roots: [{ _id: 1, first: 1, second: 2 }],
  })

  // View A has implied _id: 1 ({ name: 1 })
  const viewA = defineView({
    collection: users,
    select: { name: 1 },
  })

  // View B has explicit _id: 1 ({ _id: 1, name: 1 })
  const viewB = defineView({
    collection: users,
    select: { _id: 1, name: 1 },
  })

  const root = defineView({
    collection: roots,
    populate: {
      first: viewA,
      second: viewB,
    },
  })

  const result: any = await root.read((col) => col.findOne({ _id: 1 }))

  // Both views must batch into exactly 1 query
  assert.equal(users.queryCount, 1)
  assert.deepEqual(users.queries[0], { _id: { $in: [1, 2] } })
  assert.deepEqual(result.first, { _id: 1, name: 'Alice' })
  assert.deepEqual(result.second, { _id: 2, name: 'Bob' })
})

test('supports findOne, nulls, and empty arrays', async () => {
  const { items } = await seedDatabase()
  const view = defineView({
    collection: items,
    select: { _id: 0, name: 1 },
  })

  const single = await view.read((col, { projection }) => col.findOne({ _id: 1 }, { projection }))
  assert.deepEqual(single, { name: 'A' })

  const missing = await view.read((col, { projection }) =>
    col.findOne({ _id: 999 }, { projection }),
  )
  assert.equal(missing, null)

  const empty = await view.read((col, { projection }) =>
    col.find({ _id: 999 }, { projection }).toArray(),
  )
  assert.deepEqual(empty, [])
})

test('supports inclusive and exclusive projections passed directly to driver and loader', async () => {
  const { items } = await seedDatabase()

  const inclusiveView = defineView({
    collection: items,
    select: { name: 1 },
  })
  const inclusive = await inclusiveView.read((col, { projection }) =>
    col.findOne({ _id: 1 }, { projection }),
  )
  assert.deepEqual(inclusive, { _id: 1, name: 'A' })

  const exclusiveView = defineView({
    collection: items,
    select: { secret: 0 },
  })
  const exclusive: any = await exclusiveView.read((col, { projection }) =>
    col.findOne({ _id: 1 }, { projection }),
  )
  assert.equal(exclusive.secret, undefined)
  assert.equal(exclusive.name, 'A')

  const exclusiveWithExplicitIdView = defineView({
    collection: items,
    select: { _id: 1, secret: 0 },
  })
  const exclusiveWithExplicitId: any = await exclusiveWithExplicitIdView.read(
    (col, { projection }) => col.findOne({ _id: 1 }, { projection }),
  )
  assert.equal(exclusiveWithExplicitId._id, 1)
  assert.equal(exclusiveWithExplicitId.secret, undefined)
  assert.equal(exclusiveWithExplicitId.name, 'A')
})

test('preserves reference array order and replaces missing matches with null', async () => {
  const { tags, courses } = await seedDatabase({
    courses: [{ _id: 100, title: 'Course 100', tagIds: [2, 1, 999] }],
  })

  const tagView = defineView({
    collection: tags,
    select: { label: 1 },
  })
  const courseView = defineView({
    collection: courses,
    populate: { tagIds: tagView },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 100 }))
  assert.equal(tags.queryCount, 1)
  assert.deepEqual(tags.queries[0], { _id: { $in: [2, 1, 999] } })
  assert.deepEqual(result.tagIds, [{ _id: 2, label: 'Design' }, { _id: 1, label: 'Tech' }, null])
})

test('supports custom foreignKey on relation', async () => {
  const { partners, courses } = await seedDatabase({
    courses: [{ _id: 10, title: 'Course 10', parentOrg: 'Organization A' }],
  })

  const partnerView = defineView({
    collection: partners,
    select: { name: 1, label: 1 },
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      parentOrg: {
        view: partnerView,
        foreignKey: 'label',
      },
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 10 }))
  assert.equal(partners.queryCount, 1)
  assert.deepEqual(partners.queries[0], { label: { $in: ['Organization A'] } })
  assert.equal(result.parentOrg.name, 'Partner Org')
  assert.equal(result.parentOrg.label, 'Organization A')
})

test('isolates mutations across sibling fields and embedded array destinations', async () => {
  const { partners, courses } = await seedDatabase({
    courses: [
      {
        _id: 10,
        title: 'Ownership Course',
        partner: 1,
        reviewer: 1,
        sections: [{ author: 1 }, { author: 1 }],
      },
    ],
  })

  const partnerView = defineView({ collection: partners })
  const courseView = defineView({
    collection: courses,
    populate: {
      partner: partnerView,
      reviewer: partnerView,
      'sections.author': partnerView,
    },
  })

  const course: any = await courseView.read((col) => col.findOne({ _id: 10 }))
  assert.deepEqual(course.partner, course.reviewer)
  assert.deepEqual(course.partner, course.sections[0].author)

  // Mutating one destination must not affect the others
  course.partner.mutated = true
  assert.equal(course.reviewer.mutated, undefined)
  assert.equal(course.sections[0].author.mutated, undefined)
  assert.equal(course.sections[1].author.mutated, undefined)

  course.sections[0].author.sectionMutated = true
  assert.equal(course.sections[1].author.sectionMutated, undefined)
})
