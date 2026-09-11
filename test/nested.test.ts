import assert from 'node:assert/strict'
import test from 'node:test'
import { defineView, lazyDatabase } from '../src/index.ts'
import { db, getDb, seedDatabase, testIds } from './shared.ts'

test('populates transitive references at root and embedded array paths', async () => {
  const { partners, roots } = await seedDatabase()

  const partnerView = defineView({
    collection: partners,
  })

  const partnerWithParentView = defineView({
    collection: partners,
    populate: {
      parentName: { view: partnerView, foreignKey: 'name' },
    },
  })

  const root = defineView({
    collection: roots,
    populate: {
      partner: partnerWithParentView,
      'groups.partners': partnerWithParentView,
    },
  })

  const result: any = await root.read((col) => col.findOne({ _id: 1 }))
  assert.deepEqual(result.partner, {
    _id: 1,
    name: 'Local',
    parentName: { _id: 2, name: 'Global', parentName: null },
    label: 'Organization A',
    handle: 'org1',
  })
  assert.deepEqual(result.groups[0].partners, [
    {
      _id: 1,
      name: 'Local',
      parentName: { _id: 2, name: 'Global', parentName: null },
      label: 'Organization A',
      handle: 'org1',
    },
    { _id: 2, name: 'Global', parentName: null },
  ])
  assert.equal(partners.queryCount, 2)
})

test('handles embedded arrays with missing properties and null positions', async () => {
  const { users, courses } = await seedDatabase({
    courses: [
      {
        _id: 50,
        title: 'Ragged Course',
        chapters: [{ author: 1 }, null, null, {}, { author: null }, { author: 2 }],
      },
    ],
  })

  const userView = defineView({
    collection: users,
    select: { name: 1 },
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      'chapters.author': userView,
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 50 }))
  assert.equal(users.queryCount, 1)
  assert.deepEqual(users.queries[0], { _id: { $in: [1, 2] } })

  assert.deepEqual(result.chapters, [
    { author: { _id: 1, name: 'Alice' } },
    null,
    null,
    {},
    { author: null },
    { author: { _id: 2, name: 'Bob' } },
  ])
})

test('populates across deeply nested multi-level embedded arrays (arrays within arrays)', async () => {
  const { users, courses } = await seedDatabase({
    courses: [
      {
        _id: 60,
        title: 'Deep Array Course',
        curriculum: [
          {
            modules: [{ lessons: [{ author: 1 }, { author: 2 }] }, { lessons: [] }],
          },
          {
            modules: [{ lessons: [{ author: 1 }] }],
          },
        ],
      },
    ],
  })

  const userView = defineView({
    collection: users,
    select: { name: 1 },
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      'curriculum.modules.lessons.author': userView,
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 60 }))
  assert.equal(users.queryCount, 1)
  assert.deepEqual(users.queries[0], { _id: { $in: [1, 2] } })

  assert.deepEqual(result.curriculum[0].modules[0].lessons, [
    { author: { _id: 1, name: 'Alice' } },
    { author: { _id: 2, name: 'Bob' } },
  ])
  assert.deepEqual(result.curriculum[0].modules[1].lessons, [])
  assert.deepEqual(result.curriculum[1].modules[0].lessons, [{ author: { _id: 1, name: 'Alice' } }])
})

test('populates across consecutive nested arrays without intermediate objects', async () => {
  const { users, courses } = await seedDatabase({
    courses: [
      {
        _id: 65,
        title: 'Matrix Course',
        matrix: [[{ author: 1 }, { author: 2 }], [{ author: 1 }]],
      },
    ],
  })

  const userView = defineView({
    collection: users,
    select: { name: 1 },
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      'matrix.author': userView,
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 65 }))
  assert.equal(users.queryCount, 1)
  assert.deepEqual(users.queries[0], { _id: { $in: [1, 2] } })

  assert.deepEqual(result.matrix, [
    [{ author: { _id: 1, name: 'Alice' } }, { author: { _id: 2, name: 'Bob' } }],
    [{ author: { _id: 1, name: 'Alice' } }],
  ])
})

test('populates sibling and nested paths in subdocuments without arrays', async () => {
  const { users, courses } = await seedDatabase({
    courses: [
      {
        _id: 70,
        title: 'Subdocument Course',
        metadata: {
          audit: {
            createdBy: 1,
            reviewedBy: 2,
          },
        },
      },
    ],
  })

  const userView = defineView({
    collection: users,
    select: { name: 1 },
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      'metadata.audit.createdBy': userView,
      'metadata.audit.reviewedBy': userView,
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 70 }))
  assert.equal(users.queryCount, 1)
  assert.deepEqual(users.queries[0], { _id: { $in: [1, 2] } })
  assert.deepEqual(result.metadata.audit.createdBy, { _id: 1, name: 'Alice' })
  assert.deepEqual(result.metadata.audit.reviewedBy, { _id: 2, name: 'Bob' })
})

test('transforms all-nullish reference arrays to nulls and avoids database queries', async () => {
  const { users, courses } = await seedDatabase({
    courses: [
      {
        _id: 80,
        title: 'Nullish Course',
        coAuthors: [null, undefined, null],
      },
    ],
  })

  const userView = defineView({
    collection: users,
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      coAuthors: userView,
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 80 }))
  assert.equal(users.queryCount, 0)
  assert.deepEqual(result.coAuthors, [null, null, null])
})

test('preserves duplicate references within arrays and across sibling fields with mutation isolation', async () => {
  const { users, courses } = await seedDatabase({
    courses: [
      {
        _id: 90,
        title: 'Duplicate References Course',
        lead: 1,
        contributors: [1, 2, 1],
      },
    ],
  })

  const userView = defineView({
    collection: users,
    select: { name: 1 },
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      lead: userView,
      contributors: userView,
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 90 }))
  assert.equal(users.queryCount, 1)
  assert.deepEqual(users.queries[0], { _id: { $in: [1, 2] } })

  assert.deepEqual(result.lead, { _id: 1, name: 'Alice' })
  assert.deepEqual(result.contributors[0], { _id: 1, name: 'Alice' })
  assert.deepEqual(result.contributors[2], { _id: 1, name: 'Alice' })

  // Verify mutation isolation: modifying one instance must not affect the others
  result.lead.name = 'Modified Alice'
  assert.equal(result.contributors[0].name, 'Alice')
  assert.equal(result.contributors[2].name, 'Alice')

  result.contributors[0].name = 'Contributor Alice'
  assert.equal(result.contributors[2].name, 'Alice')
})

test('populates hierarchical self-referencing tree structures', async () => {
  const { items, roots } = await seedDatabase({
    items: [
      { _id: 10, name: 'Leaf Node', parent: 20 },
      { _id: 20, name: 'Branch Node', parent: 30 },
      { _id: 30, name: 'Root Node', parent: null },
    ],
    roots: [{ _id: 1, item: 10 }],
  })

  const level3 = defineView({ collection: items, select: { name: 1 } })
  const level2 = defineView({
    collection: items,
    select: { name: 1, parent: 1 },
    populate: { parent: level3 },
  })
  const level1 = defineView({
    collection: items,
    select: { name: 1, parent: 1 },
    populate: { parent: level2 },
  })
  const root = defineView({ collection: roots, populate: { item: level1 } })

  const result: any = await root.read((col) => col.findOne({ _id: 1 }))
  assert.equal(items.queryCount, 3)
  assert.deepEqual(result.item, {
    _id: 10,
    name: 'Leaf Node',
    parent: {
      _id: 20,
      name: 'Branch Node',
      parent: {
        _id: 30,
        name: 'Root Node',
      },
    },
  })
})

test('supports inline view configurations in populate', async () => {
  const { users, courses } = await seedDatabase({
    courses: [{ _id: 10, title: 'Course 10', reviewer: 1 }],
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      reviewer: {
        collection: users,
        select: { name: 1 },
      },
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 10 }))
  assert.equal(users.queryCount, 1)
  assert.deepEqual(result.reviewer, { _id: 1, name: 'Alice' })
})

test('supports inline view configurations with custom foreignKey', async () => {
  const { partners, courses } = await seedDatabase({
    courses: [{ _id: 10, title: 'Course 10', parentOrg: 'Organization A' }],
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      parentOrg: {
        collection: partners,
        select: { name: 1, label: 1 },
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

test('supports nested multi-level inline view configurations', async () => {
  const { users, partners, courses } = await seedDatabase({
    courses: [{ _id: 10, title: 'Course 10', partner: 10 }],
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      partner: {
        collection: partners,
        select: { name: 1, owner: 1 },
        populate: {
          owner: {
            collection: users,
            select: { name: 1 },
          },
        },
      },
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 10 }))
  assert.equal(partners.queryCount, 1)
  assert.equal(users.queryCount, 1)
  assert.deepEqual(result.partner, {
    _id: 10,
    name: 'Partner',
    owner: { _id: 100, name: 'Owner User' },
  })
})

test('supports wrapped inline view configurations in { view, foreignKey }', async () => {
  const { partners, courses } = await seedDatabase({
    courses: [{ _id: 10, title: 'Course 10', partnerHandle: 'org1' }],
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      partnerHandle: {
        view: {
          collection: partners,
          select: { name: 1, handle: 1 },
        },
        foreignKey: 'handle',
      },
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 10 }))
  assert.equal(partners.queryCount, 1)
  assert.deepEqual(result.partnerHandle, {
    _id: testIds.partner1Id,
    name: 'Partner Org',
    handle: 'org1',
  })
})

test('sibling inline view relations batch together into a single query', async () => {
  const { users, courses } = await seedDatabase({
    courses: [
      {
        _id: 1,
        title: 'Course 1',
        author: 1,
        reviewer: 2,
      },
    ],
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      author: {
        collection: users,
        select: { name: 1 },
      },
      reviewer: {
        collection: users,
        select: { name: 1 },
      },
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 1 }))
  assert.equal(users.queryCount, 1)
  assert.deepEqual(result.author, { _id: 1, name: 'Alice' })
  assert.deepEqual(result.reviewer, { _id: 2, name: 'Bob' })
})

test('shares lazy providers through multiple nested levels', async () => {
  const { items, roots } = await seedDatabase({
    items: [
      { _id: 1, parent: 3 },
      { _id: 2, parent: 3 },
      { _id: 3, parent: 3 },
    ],
    roots: [
      { _id: 1, node: 1 },
      { _id: 2, node: 2 },
    ],
  })

  let resolutions = 0
  const { Items } = lazyDatabase(async () => {
    resolutions += 1
    return { Items: items }
  })

  const level3 = defineView({ collection: Items })
  const level2 = defineView({ collection: Items, populate: { parent: level3 } })
  const level1 = defineView({ collection: Items, populate: { parent: level2 } })
  const root = defineView({
    collection: roots,
    populate: { node: level1 },
  })

  const result: any = await root.read((col) => col.find({}).sort({ _id: 1 }).toArray())
  assert.equal(result[0].node.parent.parent._id, 3)
  assert.equal(result[1].node.parent.parent._id, 3)
  assert.notEqual(result[0].node.parent, result[1].node.parent)
  assert.notEqual(result[0].node.parent, result[0].node.parent.parent)
  assert.equal(resolutions, 1)

  // Level 1: node in [1, 2]
  // Level 2: parent in [3]
  // Level 3: parent in [3]
  assert.equal(items.queryCount, 3)

  await root.read((col) => col.findOne({ _id: 1 }))
  assert.equal(resolutions, 2)
  assert.equal(items.queryCount, 6)
})

test('multi-level population preserves isolation across first-use and cloned instances', async () => {
  const { users, partners, courses } = await seedDatabase({
    courses: [
      {
        _id: 1,
        title: 'Course',
        primary: 10,
        secondary: 10,
      },
    ],
  })

  const userView = defineView({
    collection: users,
    select: { name: 1 },
  })

  const partnerView = defineView({
    collection: partners,
    select: { name: 1, owner: 1 },
    populate: { owner: userView },
  })

  const courseView = defineView({
    collection: courses,
    populate: {
      primary: partnerView,
      secondary: partnerView,
    },
  })

  const result: any = await courseView.read((col) => col.findOne({ _id: 1 }))
  assert.deepEqual(result.primary, result.secondary)
  assert.notEqual(result.primary, result.secondary)

  // Mutating nested object in primary must not leak to secondary
  result.primary.owner.name = 'Mutated'
  assert.equal(result.secondary.owner.name, 'Owner User')
})

test('matches object-valued foreign keys and populates their nested relations', async () => {
  const key = { region: 'west', number: 1 }
  const { items, roots } = await seedDatabase({
    roots: [{ _id: 1, item: key }],
  })

  const parentView = defineView({ collection: items })
  const itemView = defineView({
    collection: items,
    populate: { parent: parentView },
  })

  const root = defineView({
    collection: roots,
    populate: {
      item: { view: itemView, foreignKey: 'key' },
    },
  })

  const result: any = await root.read((col) => col.findOne({ _id: 1 }))
  assert.equal(result.item._id, 1)
  assert.deepEqual(result.item.parent, { _id: 2, name: 'B', label: 'ParentDoc', parent: 3 })
  assert.deepEqual(items.queries[0], { key: { $in: [key] } })
})

test('propagates nested query failures', async () => {
  const { items, roots } = await seedDatabase({
    roots: [{ _id: 1, item: 1 }],
  })
  const error = new Error('nested failure')
  const failing = {
    find() {
      throw error
    },
    async findOne() {
      throw error
    },
  }

  const failingView = defineView({ collection: failing })
  const itemView = defineView({
    collection: items,
    populate: { parent: failingView },
  })

  const root = defineView({
    collection: roots,
    populate: { item: itemView },
  })

  await assert.rejects(
    root.read((col) => col.findOne({ _id: 1 })),
    (caught) => caught === error,
  )
})
