import assert from 'node:assert/strict'
import test from 'node:test'
import { defineView, PopulateUnresolvedError, type PopulateUnresolvedPolicy } from '../src/index.ts'

function collection(documents: Record<string, any>[] = []) {
  let queries = 0
  return {
    get queries() {
      return queries
    },
    find(filter: Record<string, any>) {
      queries++
      const entry = Object.entries(filter)[0]
      const results = entry?.[1]?.$in
        ? documents.filter((doc) => entry[1].$in.includes(doc[entry[0]]))
        : documents
      return { toArray: async () => structuredClone(results) }
    },
    async findOne() {
      return structuredClone(documents[0] ?? null)
    },
  }
}

const policies = ['omitted', undefined, 'null', 'filter', 'throw'] as const
for (const policy of policies) {
  test(`${policy}: empty, absent, nullish and sparse values preserve source entries`, async () => {
    let calls = 0
    const target = collection()
    const view = defineView({
      collection: collection(),
      populate: {
        'sections.ids': {
          collection: () => {
            calls++
            return target
          },
          ...(policy === 'omitted' ? {} : { onUnresolved: policy }),
        },
      },
    })
    const sparse = new Array(3)
    sparse[1] = undefined
    const input = {
      sections: [
        null,
        undefined,
        {},
        { ids: null },
        { ids: undefined },
        { ids: [] },
        { ids: [null, undefined] },
        { ids: sparse },
        { ids: [undefined] },
        { ids: [null] },
        { ids: new Array(3) },
      ],
    }
    const result: any = await view.read(() => input)
    assert.deepEqual(result.sections.slice(0, 6), [
      null,
      undefined,
      {},
      { ids: null },
      { ids: undefined },
      { ids: [] },
    ])
    assert.deepEqual(result.sections[6].ids, policy === 'filter' ? [] : [null, undefined])
    const expected = new Array(3)
    expected[1] = undefined
    assert.deepEqual(result.sections[7].ids, policy === 'filter' ? [] : expected)
    assert.deepEqual(result.sections[8].ids, policy === 'filter' ? [] : [undefined])
    assert.deepEqual(result.sections[9].ids, policy === 'filter' ? [] : [null])
    assert.deepEqual(result.sections[10].ids, policy === 'filter' ? [] : new Array(3))
    assert.equal(Object.hasOwn(result.sections[7].ids, 1), policy !== 'filter')
    assert.equal(Object.hasOwn(result.sections[7].ids, 0), false)
    assert.equal(Object.hasOwn(result.sections[4], 'ids'), true)
    assert.equal(Object.hasOwn(result.sections[2], 'ids'), false)
    assert.equal(calls, 0)
    assert.equal(target.queries, 0)
    assert.equal(await view.read(() => null), null)
    assert.equal(await view.read(() => undefined), undefined)
    assert.equal(await view.findOne(), null)
    for (const sections of [null, undefined]) {
      assert.deepEqual(await view.read(() => ({ sections })), { sections })
    }
  })

  test(`${policy}: matches, missing scalar keys and leaf-array outcomes`, async () => {
    const target = collection([
      { _id: 'a', nullable: null },
      { _id: 'b', nullable: null },
    ])
    const view = defineView({
      collection: collection(),
      populate: { ref: { collection: target, ...(policy === 'omitted' ? {} : { onUnresolved: policy }) } },
    })
    assert.deepEqual(await view.read(() => ({ ref: 'a' })), { ref: { _id: 'a', nullable: null } })
    const values = ['b', 'missing', null, undefined, 'a', 'b']
    if (policy === 'throw') {
      await assert.rejects(
        view.read(() => ({ ref: values })),
        (error: unknown) => {
          assert.ok(error instanceof PopulateUnresolvedError)
          assert.equal(error.name, 'PopulateUnresolvedError')
          assert.equal(error.code, 'POPULATE_UNRESOLVED')
          assert.equal(error.path, 'ref')
          assert.equal(error.foreignKey, '_id')
          assert.equal(error.reason, 'not-found')
          assert.equal(error.index, 1)
          assert.match(error.message, /ref.*1.*not-found/)
          assert.ok(!error.message.includes('missing'))
          return true
        },
      )
      await assert.rejects(
        view.read(() => ({ ref: 'missing' })),
        { index: undefined },
      )
      assert.deepEqual(await view.read(() => ({ ref: ['a', null] })), {
        ref: [{ _id: 'a', nullable: null }, null],
      })
      assert.deepEqual(await view.read(() => ({ ref: ['a', null, undefined] })), {
        ref: [{ _id: 'a', nullable: null }, null, undefined],
      })
    } else {
      assert.deepEqual(await view.read(() => ({ ref: 'missing' })), { ref: null })
      const result: any = await view.read(() => ({ ref: values }))
      assert.deepEqual(
        result.ref,
        policy === 'filter'
          ? [{ _id: 'b', nullable: null }, { _id: 'a', nullable: null }, { _id: 'b', nullable: null }]
          : [
              { _id: 'b', nullable: null },
              null,
              null,
              undefined,
              { _id: 'a', nullable: null },
              { _id: 'b', nullable: null },
            ],
      )
      assert.notEqual(result.ref[0], result.ref.at(-1))
      result.ref[0].nullable = 'changed'
      assert.equal(result.ref.at(-1).nullable, null)
      assert.deepEqual(await view.read(() => ({ ref: ['missing'] })), {
        ref: policy === 'filter' ? [] : [null],
      })
    }
    const sparse = new Array(6)
    sparse[1] = 'a'
    sparse[3] = null
    sparse[4] = undefined
    sparse[5] = 'a'
    const result: any = await view.read(() => ({ ref: sparse }))
    const expected = new Array(6)
    expected[1] = { _id: 'a', nullable: null }
    expected[3] = null
    expected[4] = undefined
    expected[5] = { _id: 'a', nullable: null }
    assert.deepEqual(result.ref, policy === 'filter' ? [expected[1], expected[5]] : expected)
    assert.equal(0 in result.ref, policy === 'filter')
    assert.equal(4 in result.ref, policy !== 'filter')
    assert.notEqual(result.ref[policy === 'filter' ? 0 : 1], result.ref.at(-1))
  })
}

test('all entry forms support destination policies, custom keys, and shared queries', async () => {
  const target = collection([{ _id: 'a', code: 'A' }])
  const reusable = defineView({ collection: target })
  const view = defineView({
    collection: collection(),
    populate: {
      shorthand: reusable,
      defaulted: { view: reusable, onUnresolved: undefined },
      strict: { view: reusable, onUnresolved: 'throw' },
      filtered: { view: { collection: target }, onUnresolved: 'filter' },
      inline: { collection: target, onUnresolved: 'filter' },
    },
  })
  const result: any = await view.read(() => ({
    shorthand: ['missing', undefined],
    defaulted: ['missing', undefined],
    strict: ['a'],
    filtered: ['missing', 'a'],
    inline: ['a', null],
  }))
  assert.deepEqual(result.shorthand, [null, undefined])
  assert.deepEqual(result.defaulted, [null, undefined])
  assert.deepEqual(result.filtered, result.strict)
  assert.deepEqual(result.inline, result.strict)
  assert.equal(target.queries, 1)
  assert.notEqual(result.filtered[0], result.strict[0])
  const custom = defineView({
    collection: collection(),
    populate: { ref: { view: reusable, foreignKey: 'code', onUnresolved: 'throw' } },
  })
  assert.deepEqual(await custom.read(() => ({ ref: 'A' })), { ref: { _id: 'a', code: 'A' } })
  await assert.rejects(
    custom.read(() => ({ ref: 'missing' })),
    { foreignKey: 'code', path: 'ref' },
  )
})

test('filter only compacts the leaf, and child policies remain destination-specific', async () => {
  const children = collection([{ _id: 'child' }])
  const parents = collection([
    { _id: 'parent', refs: ['child', null, undefined, 'missing'] },
    { _id: 'empty', refs: [null, undefined, 'missing'] },
  ])
  const root = defineView({
    collection: collection(),
    populate: {
      'sections.author': { collection: children, onUnresolved: 'filter' },
      'sections.reviewers': { collection: children, onUnresolved: 'filter' },
      filtered: {
        collection: parents,
        onUnresolved: 'throw',
        populate: { refs: { collection: children, onUnresolved: 'filter' } },
      },
      defaulted: { collection: parents, populate: { refs: { collection: children } } },
      emptied: {
        collection: parents,
        onUnresolved: 'filter',
        populate: { refs: { collection: children, onUnresolved: 'filter' } },
      },
    },
  })
  const result: any = await root.read(() => ({
    sections: [null, undefined, { author: 'missing', reviewers: ['missing', undefined, null, 'child'] }],
    filtered: 'parent',
    defaulted: 'parent',
    emptied: ['empty'],
  }))
  assert.deepEqual(result.sections, [null, undefined, { author: null, reviewers: [{ _id: 'child' }] }])
  assert.deepEqual(result.filtered.refs, [{ _id: 'child' }])
  assert.deepEqual(result.defaulted.refs, [{ _id: 'child' }, null, undefined, null])
  assert.equal(parents.queries, 1)
  assert.equal(children.queries, 2) // Root leaves, then one shared child query.
  assert.equal(result.filtered._id, 'parent')
  assert.deepEqual(result.emptied, [{ _id: 'empty', refs: [] }])
  const strictChild = defineView({
    collection: collection(),
    populate: {
      parent: {
        collection: parents,
        onUnresolved: 'filter',
        populate: { refs: { collection: children, onUnresolved: 'throw' } },
      },
    },
  })
  await assert.rejects(
    strictChild.read(() => ({ parent: 'parent' })),
    { path: 'refs', index: 3 },
  )
})

test('strict failures reject every read method and skip excluded paths', async () => {
  const roots = collection([{ ref: 'missing' }])
  const target = collection()
  const view = defineView({
    collection: roots,
    populate: { ref: { collection: target, onUnresolved: 'throw' } },
  })
  await assert.rejects(view.find(), PopulateUnresolvedError)
  await assert.rejects(view.findOne(), PopulateUnresolvedError)
  await assert.rejects(
    view.read(() => ({ ref: 'missing' })),
    PopulateUnresolvedError,
  )
  const excluded = defineView({
    collection: roots,
    select: { ref: 0 },
    populate: { ref: { collection: target, onUnresolved: 'throw' } },
  })
  const queries = target.queries
  await excluded.read((_collection, { projection }) => {
    assert.deepEqual(projection, { ref: 0 })
    return {} // Custom loaders are responsible for applying the supplied projection.
  })
  assert.equal(target.queries, queries)
})

test('unkeyable references report their original index and unrelated errors propagate unchanged', async () => {
  const target = collection()
  const view = defineView({
    collection: collection(),
    populate: { ref: { collection: target, onUnresolved: 'throw' } },
  })
  await assert.rejects(
    view.read(() => ({ ref: [null, Symbol('private')] })),
    { reason: 'unkeyable', index: 1 },
  )
  const failure = new Error('original')
  const badValue = {
    toJSON() {
      throw failure
    },
  }
  await assert.rejects(
    view.read(() => ({ ref: badValue })),
    (error) => error === failure,
  )
  const provider = defineView({
    collection: collection(),
    populate: {
      ref: {
        collection: () => {
          throw failure
        },
        onUnresolved: 'throw',
      },
    },
  })
  await assert.rejects(
    provider.read(() => ({ ref: 'a' })),
    (error) => error === failure,
  )
  const database = defineView({
    collection: collection(),
    populate: {
      ref: {
        collection: {
          ...target,
          find() {
            throw failure
          },
        },
        onUnresolved: 'throw',
      },
    },
  })
  await assert.rejects(
    database.read(() => ({ ref: 'a' })),
    (error) => error === failure,
  )
})

test('invalid JavaScript policies fail during compilation', () => {
  for (const policy of [null, '', 'omit', {}, () => null, 0, false]) {
    for (const wrapped of [false, true]) {
      const onUnresolved = policy as PopulateUnresolvedPolicy
      assert.throws(
        () =>
          wrapped
            ? defineView({
                collection: collection(),
                populate: { ref: { view: { collection: collection() }, onUnresolved } },
              })
            : defineView({
                collection: collection(),
                populate: { ref: { collection: collection(), onUnresolved } },
              }),
        TypeError,
      )
    }
  }
})

for (const policy of policies) {
  for (const method of ['read', 'find', 'findOne'] as const) {
    test(`${policy}: ${method} applies its nullish policy to explicit loader entries`, async () => {
      const source = { ref: ['a', null, undefined] }
      const view = defineView({
        collection: collection([source]),
        populate: {
          ref: {
            collection: collection([{ _id: 'a' }]),
            ...(policy === 'omitted' ? {} : { onUnresolved: policy }),
          },
        },
      })
      const result: any =
        method === 'read'
          ? await view.read(() => structuredClone(source))
          : method === 'find'
            ? (await view.find())[0]
            : await view.findOne()
      assert.deepEqual(result.ref, policy === 'filter' ? [{ _id: 'a' }] : [{ _id: 'a' }, null, undefined])
      assert.equal(Object.hasOwn(result.ref, 2), policy !== 'filter')
    })
  }
}

for (const [value, reason] of [['missing', 'not-found'], [Symbol('private'), 'unkeyable']] as const) {
  test(`strict ${reason} retains the index after nullish entries and a hole`, async () => {
    const view = defineView({
      collection: collection(),
      populate: { ref: { collection: collection([{ _id: 'a' }]), onUnresolved: 'throw' } },
    })
    const input: unknown[] = ['a', null, undefined]
    input.length = 4
    input.push(value)
    await assert.rejects(view.read(() => ({ ref: input })), {
      name: 'PopulateUnresolvedError',
      reason,
      path: 'ref',
      index: 4,
    })
  })
}
