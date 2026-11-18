import assert from 'node:assert/strict'
import test from 'node:test'
import { defineView } from '../src/index.ts'
import { getClient, seedDatabase } from './shared.ts'

test('both sibling relations see writes in the active transaction', async (t) => {
  const client = await getClient()
  if (!(await client.db('admin').command({ hello: 1 })).setName) {
    return t.skip('requires a replica set')
  }
  const { users, items, roots } = await seedDatabase()
  const view = defineView({
    collection: roots,
    populate: { author: { collection: users }, editor: { collection: items } },
  })

  await client.withSession((session) =>
    session.withTransaction(async () => {
      await users.updateOne({ _id: 1 }, { $set: { name: 'New author' } }, { session })
      await items.updateOne({ _id: 1 }, { $set: { name: 'New editor' } }, { session })
      const doc = await view.findOne({ _id: 1 }, { session })
      assert.equal(doc?.author?.name, 'New author')
      assert.equal(doc?.editor?.name, 'New editor')
    }),
  )
})
