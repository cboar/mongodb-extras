import { after } from 'node:test'
import { MongoClient, ObjectId, type Collection, type Db, type Document } from 'mongodb'
import { cloneDocument } from '../src/utils/clone.ts'
import { lazyDatabase } from '../src/database/lazy.ts'

export interface UserDocument {
  _id: ObjectId | number
  name: string
  handle?: string
  team?: number
  secret?: boolean
}

export interface PartnerDocument {
  _id: ObjectId | number
  name: string
  handle?: string
  parentName?: string | null
  label?: string
  owner?: number
  secret?: boolean
}

export interface CourseDocument {
  _id: number
  title: string
  partner?: ObjectId | number | string
  partnerHandle?: string
  parentOrg?: string
  author?: ObjectId | number
  reviewer?: ObjectId | number
  sections?: { author?: ObjectId | number }[]
  chapters?: ({ author?: number | null } | null | undefined)[]
  curriculum?: { modules: { lessons: { author?: number }[] }[] }[]
  matrix?: { author?: number }[][]
  metadata?: { audit?: { createdBy?: number; reviewedBy?: number } }
  tagIds?: (number | null | undefined)[]
  coAuthors?: (number | null | undefined)[]
  lead?: number
  contributors?: (number | null | undefined)[]
  published?: boolean
  secret?: boolean
  internalNotes?: string
  primary?: number
  secondary?: number
}

export interface TagDocument {
  _id: number
  label: string
}

export interface ItemDocument {
  _id: number
  name?: string
  label?: string
  key?: unknown
  parent?: number | null
  secret?: boolean
  code?: unknown
}

export interface RootDocument {
  _id: number
  partner?: number | ObjectId
  groups?: { partners: (number | ObjectId)[] }[]
  refs?: unknown[]
  empty?: unknown[]
  embedded?: unknown[]
  absent?: unknown
  nullable?: unknown
  node?: number
  item?: unknown
  user?: number | null | (number | null | undefined)[]
  first?: number
  second?: number
  author?: number
  editor?: number
  items?: unknown[]
  direct?: number
  sync?: number
  async?: number
  a?: number
  b?: number
}

export interface SeedData {
  partners: PartnerDocument[]
  users: UserDocument[]
  courses: CourseDocument[]
  tags: TagDocument[]
  items: ItemDocument[]
  roots: RootDocument[]
}

export type TrackedCollection<T extends Document = Document> = Collection<T> & {
  readonly queries: Record<string, unknown>[]
  readonly queryCount: number
  resetQueries(): void
}

export interface TypedCollections {
  db: Db
  users: TrackedCollection<UserDocument>
  courses: TrackedCollection<CourseDocument>
  partners: TrackedCollection<PartnerDocument>
  tags: TrackedCollection<TagDocument>
  items: TrackedCollection<ItemDocument>
  roots: TrackedCollection<RootDocument>
}

export const defaultDbName = process.env.TEST_DB_NAME ?? `mongo_test_${process.pid}`

let client: MongoClient | undefined

export async function getClient(): Promise<MongoClient> {
  if (!client) {
    const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
    client = new MongoClient(uri)
    await client.connect()
  }
  return client
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.close()
    client = undefined
  }
}

try {
  after(async () => {
    if (client) {
      try {
        await client.db(defaultDbName).dropDatabase()
      } catch {
        // Ignore drop errors on shutdown
      }
      await closeClient()
    }
  })
} catch {
  // Outside of node:test runner context
}

export function trackCollection<T extends Document>(
  collection: Collection<T>,
): TrackedCollection<T> {
  const queries: Record<string, unknown>[] = []
  return new Proxy(collection, {
    get(target, prop, receiver) {
      if (prop === 'queries') return queries
      if (prop === 'queryCount') return queries.length
      if (prop === 'resetQueries')
        return () => {
          queries.length = 0
        }
      if (prop === 'find') {
        return (filter: any = {}, options?: any) => {
          queries.push(cloneDocument(filter))
          return target.find(filter, options)
        }
      }
      if (prop === 'findOne') {
        return (filter: any = {}, options?: any) => {
          queries.push(cloneDocument(filter))
          return target.findOne(filter, options)
        }
      }
      const val = Reflect.get(target, prop, receiver)
      return typeof val === 'function' ? val.bind(target) : val
    },
  }) as TrackedCollection<T>
}

export const testIds = {
  partner1Id: new ObjectId('650000000000000000000001'),
  partner2Id: new ObjectId('650000000000000000000002'),
  user1Id: new ObjectId('650000000000000000000011'),
  user2Id: new ObjectId('650000000000000000000012'),
}

export const seedData: SeedData = {
  partners: [
    {
      _id: testIds.partner1Id,
      name: 'Partner Org',
      parentName: 'GlobalAcademics',
      label: 'Organization A',
      handle: 'org1',
      secret: true,
      owner: 100,
    },
    { _id: 1, name: 'Local', parentName: 'Global', label: 'Organization A', handle: 'org1' },
    { _id: 2, name: 'Global', parentName: null },
    { _id: 10, name: 'Partner', owner: 100 },
  ],
  users: [
    { _id: testIds.user1Id, name: 'Alice', team: 100 },
    { _id: testIds.user2Id, name: 'Bob' },
    { _id: 1, name: 'Alice', team: 100 },
    { _id: 2, name: 'Bob' },
    { _id: 3, name: 'Charlie' },
    { _id: 100, name: 'Owner User' },
  ],
  courses: [
    {
      _id: 1,
      title: 'B',
      partner: testIds.partner1Id,
      reviewer: testIds.user1Id,
      sections: [{ author: testIds.user2Id }, { author: testIds.user1Id }],
      published: true,
      secret: true,
      tagIds: [1, 2],
    },
    {
      _id: 2,
      title: 'A',
      partner: testIds.partner1Id,
      reviewer: testIds.user2Id,
      sections: [{ author: testIds.user1Id }],
      published: true,
      secret: true,
      tagIds: [2, 3],
    },
    {
      _id: 10,
      title: 'Course 10',
      partner: 10,
      parentOrg: 'OrgA',
      partnerHandle: 'org1',
      reviewer: 1,
    },
  ],
  tags: [
    { _id: 1, label: 'Tech' },
    { _id: 2, label: 'Design' },
    { _id: 3, label: 'News' },
  ],
  items: [
    {
      _id: 1,
      name: 'A',
      key: { region: 'west', number: 1 },
      parent: 2,
      secret: true,
    },
    {
      _id: 2,
      name: 'B',
      label: 'ParentDoc',
      parent: 3,
    },
    {
      _id: 3,
      name: 'C',
      parent: null,
    },
  ],
  roots: [
    {
      _id: 1,
      partner: 1,
      groups: [{ partners: [1, 2] }],
      node: 1,
      author: 1,
      editor: 1,
      first: 1,
      second: 2,
    },
  ],
}

export async function getDb(dbName = defaultDbName): Promise<TypedCollections> {
  const c = await getClient()
  const db = c.db(dbName)
  return {
    db,
    users: trackCollection(db.collection<UserDocument>('users')),
    courses: trackCollection(db.collection<CourseDocument>('courses')),
    partners: trackCollection(db.collection<PartnerDocument>('partners')),
    tags: trackCollection(db.collection<TagDocument>('tags')),
    items: trackCollection(db.collection<ItemDocument>('items')),
    roots: trackCollection(db.collection<RootDocument>('roots')),
  }
}

export const db = lazyDatabase(getDb)

export async function seedDatabase(
  customData?: Partial<SeedData>,
  dbName = defaultDbName,
): Promise<TypedCollections> {
  const collections = await getDb(dbName)
  const data = { ...seedData, ...customData }

  const resetOps = Object.entries(data).map(async ([name, docs]) => {
    const col = collections[name as keyof TypedCollections]
    if (col && typeof (col as any).deleteMany === 'function') {
      await (col as any).deleteMany({})
      if (Array.isArray(docs) && docs.length > 0) {
        await (col as any).insertMany(cloneDocument(docs))
      }
      if (typeof (col as any).resetQueries === 'function') {
        ;(col as any).resetQueries()
      }
    }
  })

  await Promise.all(resetOps)
  return collections
}
