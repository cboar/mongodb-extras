import assert from 'node:assert/strict'
import test from 'node:test'
import type { ClientSession } from 'mongodb'
import { defineView } from '../src/index.ts'
import type { DocumentSelection } from '../src/types/core.ts'
import { analyzeSelection } from '../src/view/selection.ts'
import { getViewPlan } from '../src/view/plan.ts'
import { db, getDb, seedDatabase, testIds } from './shared.ts'

function computeSelectionKey(select?: DocumentSelection): string {
  return analyzeSelection(select).selectionKey
}

test('analyzeSelection canonicalizes implied _id, key ordering, and empty selections', () => {
  // Implied vs explicit _id in inclusion projections
  assert.equal(computeSelectionKey({ name: 1 }), computeSelectionKey({ _id: 1, name: 1 }))
  assert.equal(
    computeSelectionKey({ name: 1, age: 1 }),
    computeSelectionKey({ age: 1, _id: 1, name: 1 }),
  )

  // Implied vs explicit _id in exclusion projections
  assert.equal(computeSelectionKey({ secret: 0 }), computeSelectionKey({ _id: 1, secret: 0 }))

  // Empty vs undefined
  assert.equal(computeSelectionKey(undefined), '')
  assert.equal(computeSelectionKey({}), '')
  assert.equal(computeSelectionKey(undefined), computeSelectionKey({}))

  // Distinct cases must not collide
  assert.notEqual(computeSelectionKey({ name: 1 }), computeSelectionKey({ _id: 0, name: 1 }))
  assert.notEqual(computeSelectionKey({ _id: 1 }), computeSelectionKey({}))
})

test('analyzeSelection safely handles Object.freeze selections', () => {
  const frozenSelect = Object.freeze({ name: 1 as const })
  const analysis1 = analyzeSelection(frozenSelect)
  const analysis2 = analyzeSelection(frozenSelect)

  assert.deepEqual(analysis1, analysis2)
  assert.equal(analysis1.isInclusive, true)
  assert.equal(analysis1.selectionKey, '[["name",1]]')

  const view = defineView({
    collection: db.items,
    select: frozenSelect,
  })
  assert.ok(view)
})

test('rejects cursor return from loader', async () => {
  const { items } = await getDb()
  const view = defineView({ collection: items })
  await assert.rejects(
    () => view.read((collection) => collection.find({}) as any),
    /must return materialized documents, not a cursor/,
  )
})

test('propagates find and findOne sessions through nested population queries', async () => {
  const session = {} as ClientSession
  const calls: Array<{ collection: string; operation: string; options: any }> = []

  function collection(name: string, documents: any[]) {
    return {
      find(_filter: any, options?: any) {
        calls.push({ collection: name, operation: 'find', options })
        return { toArray: async () => structuredClone(documents) }
      },
      async findOne(_filter: any, options?: any) {
        calls.push({ collection: name, operation: 'findOne', options })
        return structuredClone(documents[0] ?? null)
      },
    }
  }

  const grandparents = collection('grandparents', [{ _id: 3, name: 'Grandparent' }])
  const parents = collection('parents', [{ _id: 2, grandparent: 3 }])
  const roots = collection('roots', [{ _id: 1, parent: 2 }])

  const grandparentView = defineView({ collection: grandparents })
  const parentView = defineView({
    collection: parents,
    populate: { grandparent: grandparentView },
  })
  const rootView = defineView({ collection: roots, populate: { parent: parentView } })

  await rootView.find({}, { session })
  assert.deepEqual(
    calls.map(({ collection, operation }) => [collection, operation]),
    [
      ['roots', 'find'],
      ['parents', 'find'],
      ['grandparents', 'find'],
    ],
  )
  assert.ok(calls.every((call) => call.options.session === session))

  calls.length = 0
  await rootView.findOne({}, { session })
  assert.deepEqual(
    calls.map(({ collection, operation }) => [collection, operation]),
    [
      ['roots', 'findOne'],
      ['parents', 'find'],
      ['grandparents', 'find'],
    ],
  )
  assert.ok(calls.every((call) => call.options.session === session))
})

test('accepts population session options for custom read loaders', async () => {
  const session = {} as ClientSession
  let relationOptions: any
  const related = {
    find(_filter: any, options?: any) {
      relationOptions = options
      return { toArray: async () => [{ _id: 2, name: 'Related' }] }
    },
    async findOne() {
      return null
    },
  }
  const root = {
    find() {
      return { toArray: async () => [{ _id: 1, related: 2 }] }
    },
    async findOne() {
      return { _id: 1, related: 2 }
    },
  }
  const view = defineView({
    collection: root,
    populate: { related: defineView({ collection: related }) },
  })

  await view.read(() => root.find().toArray(), { populateOptions: { session } })

  assert.equal(relationOptions.session, session)
})

test('nullish references returned by MongoDB do not resolve provider', async () => {
  let resolved = false
  const unusedView = defineView({
    collection: () => {
      resolved = true
      return (async () => (await getDb()).items)()
    },
  })
  const { roots } = await seedDatabase({
    roots: [{ _id: 100, items: [null, undefined] }],
  })
  const root = defineView({
    collection: roots,
    populate: { items: unusedView },
  })
  let loaded: unknown
  const result: any = await root.read(async (col) => {
    const document = await col.findOne({ _id: 100 })
    // MongoDB serialization can turn undefined array entries into null.
    loaded = structuredClone(document?.items)
    return document
  })
  assert.deepEqual(result.items, loaded)
  assert.equal(resolved, false)
})

test('validates matching key retention at definition time', () => {
  const { items } = db

  // Target explicitly excludes _id (implied matching key) -> error
  assert.throws(
    () =>
      defineView({
        collection: items,
        populate: {
          item: defineView({ collection: items, select: { _id: 0, name: 1 } }),
        },
      }),
    /excluded by the target view selection/,
  )

  // Target includes matching foreignKey -> OK
  assert.doesNotThrow(() =>
    defineView({
      collection: items,
      populate: {
        item: {
          view: defineView({ collection: items, select: { code: 1 } }),
          foreignKey: 'code',
        },
      },
    }),
  )

  // Target does not include custom foreignKey in inclusion projection -> error
  assert.throws(
    () =>
      defineView({
        collection: items,
        populate: {
          item: {
            view: defineView({ collection: items, select: { name: 1 } }),
            foreignKey: 'code',
          },
        },
      }),
    /excluded by the target view selection/,
  )

  // Target explicitly excludes custom foreignKey in exclusion projection -> error
  assert.throws(
    () =>
      defineView({
        collection: items,
        populate: {
          item: {
            view: defineView({ collection: items, select: { code: 0 } }),
            foreignKey: 'code',
          },
        },
      }),
    /excluded by the target view selection/,
  )
})

test('rejects partial matching-key projections at definition time', () => {
  const { items } = db

  // If matching key is 'key', but target view only selects 'key.code', reject
  assert.throws(
    () =>
      defineView({
        collection: items,
        populate: {
          item: {
            view: defineView({
              collection: items,
              select: { 'key.code': 1 as const },
            }),
            foreignKey: 'key',
          },
        },
      }),
    /excluded by the target view selection/,
  )
})

test('defineView rejects conflicting populate path prefixes', () => {
  const { roots, users } = db
  const fakeView = defineView({ collection: users })

  assert.throws(
    () =>
      defineView({
        collection: roots,
        populate: {
          user: fakeView,
          'user.profile': fakeView,
        },
      }),
    /Conflicting populate paths/,
  )

  assert.throws(
    () =>
      defineView({
        collection: roots,
        populate: {
          'items.tags': fakeView,
          items: fakeView,
        },
      }),
    /Conflicting populate paths/,
  )
})

test('defineView rejects malformed populate paths', () => {
  const { roots, users } = db
  const fakeView = defineView({ collection: users })

  for (const badPath of ['', '.user', 'user.', 'user..profile']) {
    assert.throws(
      () =>
        defineView({
          collection: roots,
          populate: { [badPath]: fakeView },
        }),
      /Invalid populate path/,
    )
  }
})

test('reuses compiled plans for identical root and relation config references', () => {
  const { roots, users } = db
  const targetConfig = { collection: users, select: { name: 1 as const } }
  const rootConfig = {
    collection: roots,
    populate: {
      a: targetConfig,
      b: targetConfig,
    },
  }
  const view1 = defineView(rootConfig)
  const view2 = defineView(rootConfig)
  const plan = getViewPlan(view1)
  assert.ok(plan)
  assert.equal(getViewPlan(view2), plan)
  assert.equal(getViewPlan(rootConfig), plan)
  assert.equal(plan.relations.length, 2)
  assert.ok(plan.relations[0]?.targetView)
  assert.equal(plan.relations[0].targetView, getViewPlan(targetConfig))
  assert.equal(plan.relations[0].targetView, plan.relations[1]?.targetView)
})

test('detects circular references during view plan compilation', () => {
  const { users } = db
  const circular: any = {
    collection: users,
  }
  circular.populate = {
    self: circular,
  }

  assert.throws(
    () => defineView(circular),
    /Circular reference detected during view plan compilation/,
  )
})

test('validates matching key retention in inline view configurations', () => {
  const { courses, users } = db
  assert.throws(
    () =>
      defineView({
        collection: courses,
        populate: {
          reviewer: {
            collection: users,
            select: { _id: 0, name: 1 },
          },
        },
      }),
    /Relation at "reviewer" matches on "_id", which is excluded by the target view selection/,
  )
})

test('rejects an empty foreignKey', () => {
  const { courses, users } = db
  assert.throws(
    () =>
      defineView({
        collection: courses,
        populate: {
          reviewer: {
            view: defineView({ collection: users }),
            foreignKey: '',
          },
        },
      }),
    /Relation "foreignKey" must be a non-empty string/,
  )
})

test('view.find and view.findOne return projected, populated documents with one query per collection', async () => {
  const { courses, users } = await seedDatabase()
  const userSummary = defineView({
    collection: users,
    select: { name: 1 },
  })
  const courseView = defineView({
    collection: courses,
    select: { title: 1, reviewer: 1 },
    populate: { reviewer: userSummary },
  })

  const found = await courseView.find(
    { published: true },
    { sort: { title: 1 }, limit: 1 },
  )
  assert.deepEqual(found, [
    { _id: 2, title: 'A', reviewer: { _id: testIds.user2Id, name: 'Bob' } },
  ])
  assert.equal(courses.queryCount, 1)
  assert.equal(users.queryCount, 1)

  courses.resetQueries()
  users.resetQueries()
  const single = await courseView.findOne({ _id: 1 })
  assert.deepEqual(single, {
    _id: 1,
    title: 'B',
    reviewer: { _id: testIds.user1Id, name: 'Alice' },
  })
  assert.equal(courses.queryCount, 1)
  assert.equal(users.queryCount, 1)
})

test('view.find supports default arguments (find all)', async () => {
  const { tags } = await seedDatabase()
  const tagView = defineView({ collection: tags })
  const allTags = await tagView.find()
  assert.equal(allTags.length, 3)
})

test('view.find and view.findOne support filtering on unprojected source schema fields', async () => {
  const { courses } = await seedDatabase()
  const courseTitles = defineView({
    collection: courses,
    select: { title: 1 },
  })

  // published is not in select, but is queryable in filter
  const publishedCourses = await courseTitles.find({ published: true }, { sort: { title: 1 } })
  assert.equal(publishedCourses.length, 2)
  assert.deepEqual(
    publishedCourses.map((c) => c.title),
    ['A', 'B'],
  )
  assert.equal('published' in publishedCourses[0]!, false)

  const secretCourse = await courseTitles.findOne({ secret: true }, { sort: { title: 1 } })
  assert.ok(secretCourse)
  assert.equal(secretCourse.title, 'A')
  assert.equal('secret' in secretCourse, false)
})

test('view.find and view.findOne work when detached from view instance', async () => {
  const { courses } = await seedDatabase()
  const courseView = defineView({
    collection: courses,
    select: { title: 1 },
  })

  const { find, findOne } = courseView
  const found = await find({ _id: 1 })
  assert.equal(found.length, 1)
  assert.equal(found[0]?.title, 'B')

  const single = await findOne({ _id: 1 })
  assert.equal(single?.title, 'B')
})

test('view.find and view.findOne enforce view projection precedence and handle frozen options', async () => {
  const { courses } = await seedDatabase()
  const courseView = defineView({
    collection: courses,
    select: { title: 1 },
  })

  // Frozen options
  const frozenOptions = Object.freeze({ sort: { title: 1 } as const, skip: 0, limit: 1 })
  const res = await courseView.find({}, frozenOptions)
  assert.equal(res.length, 1)

  // Deliberate cast with caller projection attempt -> view's plan.select wins
  const badOptions = { sort: { title: 1 }, projection: { _id: 0, partner: 1 } }
  const overridden = await courseView.find({}, badOptions as any)
  assert.ok(overridden[0])
  assert.ok('title' in overridden[0]!)
  assert.equal('partner' in overridden[0]!, false)

  const overriddenOne = await courseView.findOne({ _id: 1 }, badOptions as any)
  assert.ok(overriddenOne)
  assert.ok('title' in overriddenOne!)
  assert.equal('partner' in overriddenOne!, false)
})

test('view.find and view.findOne return empty array / null on no matches without launching relation queries', async () => {
  const { courses, users } = await seedDatabase()
  users.resetQueries()

  const courseView = defineView({
    collection: courses,
    populate: {
      reviewer: defineView({ collection: users }),
    },
  })

  const emptyList = await courseView.find({ _id: 999999 })
  assert.deepEqual(emptyList, [])
  assert.equal(users.queryCount, 0)

  const missingDoc = await courseView.findOne({ _id: 999999 })
  assert.equal(missingDoc, null)
  assert.equal(users.queryCount, 0)
})

test('view.find and view.findOne enforce projection precedence when select is omitted', async () => {
  const { courses } = await seedDatabase()
  const fullCourseView = defineView({ collection: courses })

  // Caller attempts to project only title via runtime option
  const docs = await fullCourseView.find({}, { projection: { title: 1 } } as any)
  assert.ok(docs[0])
  assert.ok('title' in docs[0]!)
  // All other fields remain present because view has no select
  assert.ok('partner' in docs[0]!)
  assert.ok('published' in docs[0]!)

  const single = await fullCourseView.findOne({ _id: 1 }, { projection: { title: 1 } } as any)
  assert.ok(single)
  assert.ok('title' in single!)
  assert.ok('partner' in single!)
  assert.ok('published' in single!)
})

test('implicit inclusion adds populated keys to inclusive selections', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  // 1. Top-level implicit inclusion: select: { title: 1 } implicitly includes reviewer: 1
  const courseView = defineView({
    collection: courses,
    select: { title: 1 },
    populate: { reviewer: userView },
  })

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, { title: 1, reviewer: 1 })
  assert.equal(plan?.isInclusive, true)

  const found = await courseView.find({ _id: 1 })
  assert.equal(found.length, 1)
  assert.equal(found[0]?.title, 'B')
  assert.deepEqual(found[0]?.reviewer, { _id: testIds.user1Id, name: 'Alice' })
  // Unprojected fields should not be returned by MongoDB
  assert.equal('published' in found[0]!, false)
  assert.equal('partner' in found[0]!, false)
})

test('implicit inclusion adds nested dot-paths to inclusive selections', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  const courseView = defineView({
    collection: courses,
    select: { title: 1 },
    populate: { 'sections.author': userView },
  })

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, { title: 1, 'sections.author': 1 })

  const doc = await courseView.findOne({ _id: 1 })
  assert.ok(doc)
  assert.equal(doc.title, 'B')
  assert.equal(doc.sections?.length, 2)
  assert.deepEqual(doc.sections[0]?.author, { _id: testIds.user2Id, name: 'Bob' })
  assert.deepEqual(doc.sections[1]?.author, { _id: testIds.user1Id, name: 'Alice' })
})

test('implicit inclusion avoids duplicate projection when ancestor is already selected', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  // sections: 1 is already selected; sections.author should not be added (avoids Mongo collision)
  const courseView = defineView({
    collection: courses,
    select: { title: 1, sections: 1 },
    populate: { 'sections.author': userView },
  })

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, { title: 1, sections: 1 })

  const doc = await courseView.findOne({ _id: 1 })
  assert.ok(doc)
  assert.equal(doc.title, 'B')
  assert.equal(doc.sections?.length, 2)
  assert.deepEqual(doc.sections[0]?.author, { _id: testIds.user2Id, name: 'Bob' })
})

test('implicit inclusion supports sibling nested projections', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  const courseView = defineView({
    collection: courses,
    select: { title: 1, 'metadata.audit.reviewedBy': 1 },
    populate: { 'metadata.audit.createdBy': userView },
  })

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, {
    title: 1,
    'metadata.audit.reviewedBy': 1,
    'metadata.audit.createdBy': 1,
  })
})

test('implicit inclusion does not add populates when select is omitted (undefined)', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  const courseView = defineView({
    collection: courses,
    populate: { reviewer: userView },
  })

  const plan = getViewPlan(courseView)
  assert.equal(plan?.select, undefined)
  assert.equal(plan?.isInclusive, false)

  const doc = await courseView.findOne({ _id: 1 })
  assert.ok(doc)
  // The source fields remain available without a selection.
  assert.equal(doc.title, 'B')
  assert.equal(doc.published, true)
  assert.equal(doc.secret, true)
  assert.deepEqual(doc.reviewer, { _id: testIds.user1Id, name: 'Alice' })
})

test('implicit inclusion does not add populates when select is exclusive', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  // Exclusion projection { secret: 0 }
  const courseView = defineView({
    collection: courses,
    select: { secret: 0 },
    populate: { reviewer: userView },
  })

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, { secret: 0 })
  assert.equal(plan?.isInclusive, false)

  const doc = await courseView.findOne({ _id: 1 })
  assert.ok(doc)
  assert.equal(doc.title, 'B')
  assert.equal(doc.published, true)
  assert.equal('secret' in doc, false)
  assert.deepEqual(doc.reviewer, { _id: testIds.user1Id, name: 'Alice' })

  // Exclusion projection { _id: 0 }
  const noIdView = defineView({
    collection: courses,
    select: { _id: 0 },
    populate: { reviewer: userView },
  })

  const noIdPlan = getViewPlan(noIdView)
  assert.deepEqual(noIdPlan?.select, { _id: 0 })
  assert.equal(noIdPlan?.isInclusive, false)

  const noIdDoc = await noIdView.findOne({ _id: 1 })
  assert.ok(noIdDoc)
  assert.equal('_id' in noIdDoc, false)
  assert.equal(noIdDoc.title, 'B')
  assert.equal(noIdDoc.published, true)
  assert.deepEqual(noIdDoc.reviewer, { _id: testIds.user1Id, name: 'Alice' })
})

test('implicit inclusion handles _id: 1 and _id: 0 with inclusions', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  // select: { _id: 1 } is inclusive; reviewer should be added
  const idOnlyView = defineView({
    collection: courses,
    select: { _id: 1 },
    populate: { reviewer: userView },
  })

  const idOnlyPlan = getViewPlan(idOnlyView)
  assert.deepEqual(idOnlyPlan?.select, { _id: 1, reviewer: 1 })
  assert.equal(idOnlyPlan?.isInclusive, true)

  const idOnlyDoc = await idOnlyView.findOne({ _id: 1 })
  assert.ok(idOnlyDoc)
  assert.equal(idOnlyDoc._id, 1)
  assert.deepEqual(idOnlyDoc.reviewer, { _id: testIds.user1Id, name: 'Alice' })
  assert.equal('title' in idOnlyDoc, false)

  // select: { _id: 0, title: 1 } is inclusive without _id
  const noIdInclusionView = defineView({
    collection: courses,
    select: { _id: 0, title: 1 },
    populate: { reviewer: userView },
  })

  const noIdInclusionPlan = getViewPlan(noIdInclusionView)
  assert.deepEqual(noIdInclusionPlan?.select, { _id: 0, title: 1, reviewer: 1 })

  const noIdInclusionDoc = await noIdInclusionView.findOne({ _id: 1 })
  assert.ok(noIdInclusionDoc)
  assert.equal('_id' in noIdInclusionDoc, false)
  assert.equal(noIdInclusionDoc.title, 'B')
  assert.deepEqual(noIdInclusionDoc.reviewer, { _id: testIds.user1Id, name: 'Alice' })
})

test('implicit inclusion safely handles Object.freeze selections', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  const frozenSelect = Object.freeze({ title: 1 as const })
  const courseView = defineView({
    collection: courses,
    select: frozenSelect,
    populate: { reviewer: userView },
  })

  // Original frozen object should not be mutated
  assert.deepEqual(frozenSelect, { title: 1 })
  assert.equal(Object.keys(frozenSelect).length, 1)

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, { title: 1, reviewer: 1 })
  assert.ok(Object.isFrozen(plan?.select))
})

test('sibling relations targeting views with implicit and explicit selections batch into a single $in query', async () => {
  const { courses, users, tags } = await seedDatabase()
  users.resetQueries()

  const tagView = defineView({ collection: tags, select: { label: 1 } })

  // targetViewImplicit has select: { name: 1 } and populates team
  // During compilation, team: 1 is implicitly added, resulting in compiled select: { name: 1, team: 1 }
  const targetViewImplicit = defineView({
    collection: users,
    select: { name: 1 },
    populate: { team: tagView },
  })

  // targetViewExplicit has select: { name: 1, team: 1 } explicitly
  const targetViewExplicit = defineView({
    collection: users,
    select: { name: 1, team: 1 },
    populate: { team: tagView },
  })

  // Both target views must share the exact same selectionKey
  assert.equal(
    getViewPlan(targetViewImplicit)?.selectionKey,
    getViewPlan(targetViewExplicit)?.selectionKey,
  )

  // Attach both target views as sibling relations in a single root view
  const rootCourseView = defineView({
    collection: courses,
    select: { title: 1, reviewer: 1, 'sections.author': 1 },
    populate: {
      reviewer: targetViewImplicit,
      'sections.author': targetViewExplicit,
    },
  })

  // Course 1 has reviewer (user1Id) and sections.author (user2Id and user1Id)
  const doc: any = await rootCourseView.findOne({ _id: 1 })
  assert.ok(doc)

  // Both relations target users with matching compiled selectionKey, so they share one query.
  assert.equal(users.queryCount, 1)
  const userQueryIds = (users.queries[0] as any)._id.$in
  assert.equal(userQueryIds.length, 2)
  assert.ok(userQueryIds.some((id: any) => id.equals(testIds.user1Id)))
  assert.ok(userQueryIds.some((id: any) => id.equals(testIds.user2Id)))

  // Verify population completed for both
  assert.equal(doc.reviewer.name, 'Alice')
  assert.equal(doc.sections[0].author.name, 'Bob')
  assert.equal(doc.sections[1].author.name, 'Alice')
})

test('implicit inclusion replaces selected descendants with populated parent to avoid path collisions', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  // User wrote select: { title: 1, 'reviewer.secret': 1 } but populates 'reviewer'
  // 'reviewer.secret' is a descendant of populated path 'reviewer'
  // Compilation must delete 'reviewer.secret' and set 'reviewer: 1' to avoid MongoDB path collision
  const courseView = defineView({
    collection: courses,
    select: { title: 1, 'reviewer.secret': 1 as any },
    populate: { reviewer: userView },
  })

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, { title: 1, reviewer: 1 })
  assert.equal('reviewer.secret' in (plan?.select ?? {}), false)

  // Verify MongoDB query succeeds without path collision
  const doc: any = await courseView.findOne({ _id: 1 })
  assert.ok(doc)
  assert.equal(doc.title, 'B')
  assert.deepEqual(doc.reviewer, { _id: testIds.user1Id, name: 'Alice' })
})

test('implicit inclusion does not add populates when select is an explicit empty object', async () => {
  const { courses, users } = await seedDatabase()
  const userView = defineView({ collection: users, select: { name: 1 } })

  const courseView = defineView({
    collection: courses,
    select: {},
    populate: { reviewer: userView },
  })

  const plan = getViewPlan(courseView)
  assert.deepEqual(plan?.select, {})
  assert.equal(plan?.isInclusive, false)

  const doc: any = await courseView.findOne({ _id: 1 })
  assert.ok(doc)
  // All fields of the source document must be returned (not restricted to reviewer)
  assert.equal(doc.title, 'B')
  assert.equal(doc.published, true)
  assert.equal(doc.secret, true)
  assert.deepEqual(doc.reviewer, { _id: testIds.user1Id, name: 'Alice' })
})
