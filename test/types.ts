// Compile-time checks included by tsconfig, not executed by the test runner.
import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb'
import {
  defineView,
  lazyDatabase,
  type CollectionSource,
  type DocumentSelection,
  type PopulateMap,
  type View,
  type ViewConfig,
} from '../src/index.ts'
import type { TrackedCollection } from './shared.ts'

// Implementation helpers are intentionally absent from the package entry point.
// @ts-expect-error Use ViewDocument instead of its internal projection stages.
import type { ApplyProjection } from '../src/index.ts'
// @ts-expect-error Collection compatibility is enforced by defineView.
import type { HasCompatibleFindOne } from '../src/index.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

// --- Lazy Database Type Tests ---
type UserDoc = { name: string }
type ProductDoc = { _id: string; price: number }
let client: Promise<MongoClient>
async function getDb() {
  if (!client) {
    client = MongoClient.connect('mongodb://localhost:27017')
  }
  const db = (await client).db('test')
  return {
    db,
    Users: db.collection<UserDoc>('myusers'),
    Products: db.collection<ProductDoc>('myproducts'),
  }
}

declare const getSyncDb: () => { db: Db; Users: Collection<UserDoc> }
declare const getTrackedDb: () => Promise<{ Users: TrackedCollection<UserDoc> }>

const database = lazyDatabase(getDb)
const { Users, Products } = database
const syncUsers = lazyDatabase(getSyncDb).Users
const trackedUsers = lazyDatabase(getTrackedDb).Users

type UserCollection = Expect<Equal<Awaited<ReturnType<typeof Users>>, Collection<UserDoc>>>
type ProductCollection = Expect<Equal<Awaited<ReturnType<typeof Products>>, Collection<ProductDoc>>>
type DatabaseType = Expect<Equal<Awaited<ReturnType<typeof database.db>>, Db>>
type SyncCollection = Expect<Equal<Awaited<ReturnType<typeof syncUsers>>, Collection<UserDoc>>>
type TrackedCollectionType = Expect<
  Equal<Awaited<ReturnType<typeof trackedUsers>>, TrackedCollection<UserDoc>>
>

const promisedUsers = lazyDatabase(() => ({ Users: getTrackedDb().then((db) => db.Users) })).Users
type PromisedCollection = Expect<
  Equal<ReturnType<typeof promisedUsers>, Promise<TrackedCollection<UserDoc>>>
>

const reservedProperty = lazyDatabase(() => ({ then: 'reserved', Users: trackedUsers }))
// @ts-expect-error The proxy reserves then to prevent promise assimilation.
reservedProperty.then

// @ts-expect-error Collection aliases are inferred from getDb's return value.
database.UnknownCollection
// @ts-expect-error Physical collection names are not aliases in getDb's return value.
database.myusers
// @ts-expect-error A product provider cannot be used as a user provider.
const incorrectProvider: typeof Users = Products
const invalidPopulation = {
  // @ts-expect-error The Db property is not a collection provider.
  user: defineView({ collection: database.db }),
}

// --- View Type Tests ---
// Broad relation recognition must not weaken the defaults exposed to consumers.
type DefaultViewDocuments = Expect<Equal<Awaited<ReturnType<View['find']>>, unknown[]>>
type DefaultViewCollection = Expect<Equal<View['collection'], CollectionSource>>

type Course = { _id: string; title: string; partner: string }
type Partner = { _id: string; name: string }
declare const courses: Collection<Course>
declare const partners: Collection<Partner>
const { Courses } = lazyDatabase(() => ({ Courses: courses }))

const partner = defineView({ collection: partners, select: { _id: 0, name: 1 } })
const course = defineView({
  collection: Courses,
  select: { title: 1, partner: 1 },
  populate: { partner },
})
type Source = Expect<Equal<typeof course.collection, typeof Courses>>
type ConcreteSource = Expect<Equal<typeof partner.collection, Collection<Partner>>>

course.read((collection, { projection }) => {
  type NativeCollection = Expect<Equal<typeof collection, Collection<Course>>>
  return collection
    .find({ title: 'Example' }, { projection })
    .sort({ title: 1 })
    .limit(20)
    .toArray()
})
course.read(async (collection, { projection }) => {
  const result = await collection.findOne({ _id: 'course' }, { projection })
  if (result) {
    const title: string = result.title
    // @ts-expect-error Native query results retain source schema types.
    const invalid: number = result.title
  }
  return result
})
const synchronous = defineView({ collection: () => courses })
synchronous.read((collection, { projection }) => {
  type NativeCollection = Expect<Equal<typeof collection, Collection<Course>>>
  const cursor = collection.find({})
  return (projection ? cursor.project(projection) : cursor).toArray()
})

course.find({ title: 'Example' }, { sort: { title: 1 }, limit: 20 })
course.findOne({ _id: 'course' })

// @ts-expect-error Native collection types are preserved, including filter keys/types.
course.find({ _id: 123 })
// @ts-expect-error Projection option is forbidden on find
course.find({}, { projection: { title: 1 } })
// @ts-expect-error Projection option is forbidden on findOne
course.findOne({}, { projection: { title: 1 } })

// Projection-bearing options variable is rejected even when optional
declare const nativeOptionsWithProjection: { sort: { title: 1 }; projection?: { name: 1 } }
// @ts-expect-error Options variable containing possible projection is rejected on find
course.find({}, nativeOptionsWithProjection)
// @ts-expect-error Options variable containing possible projection is rejected on findOne
course.findOne({}, nativeOptionsWithProjection)

// findOne-specific option restrictions (limit, batchSize, timeoutMode are forbidden)
// @ts-expect-error findOne does not accept limit in options
course.findOne({}, { limit: 1 })
// @ts-expect-error findOne does not accept batchSize in options
course.findOne({}, { batchSize: 1 })
// @ts-expect-error findOne does not accept timeoutMode in options
course.findOne({}, { timeoutMode: 'cursorLifetime' })

declare const optionsWithTimeoutMode: { sort: { title: 1 }; timeoutMode?: 'cursorLifetime' }
// @ts-expect-error Options containing timeoutMode are rejected even with older driver types
course.findOne({}, optionsWithTimeoutMode)

// Detached method call compatibility
const { find: detachedFind, findOne: detachedFindOne } = course
detachedFind()
detachedFindOne()

// Method reuse on another object
const repository = { get: course.findOne }
repository.get({ _id: 'course' })

// Interface-based structural adapter retains filter typing
interface RowInterface {
  _id: number
  name: string
}
declare const rowCollection: {
  find(filter: any, options?: any): { toArray(): Promise<RowInterface[]> }
  findOne(filter: any, options?: any): Promise<RowInterface | null>
}
const rowView = defineView({ collection: rowCollection })
rowView.find({ name: 'Alice' })
// @ts-expect-error _id must be a number for RowInterface
rowView.find({ _id: 'not-a-number' })
rowView.findOne({ name: 'Alice' })
// @ts-expect-error _id must be a number for RowInterface
rowView.findOne({ _id: 'not-a-number' })

// Capability constraint: minimal collection without findOne triggers @ts-expect-error on defineView
defineView({
  // @ts-expect-error findOne is required on collection
  collection: { find: (_filter: any, _opts: any) => ({ toArray: async () => [] }) },
})

// Incompatible findOne method (e.g. returns number instead of Promise<document | null>)
defineView({
  collection: {
    find: (_filter: any, _opts: any) => ({ toArray: async () => [] }),
    // @ts-expect-error findOne must return a Promise
    findOne: (_id: number) => 123,
  },
})

defineView({
  collection: {
    ...rowCollection,
    // @ts-expect-error findOne must accept a filter document, not a scalar ID
    findOne: async (_id: number): Promise<RowInterface | null> => null,
  },
})

defineView({
  collection: {
    ...rowCollection,
    // @ts-expect-error findOne cannot require options the helper does not supply
    findOne: async (
      _filter: unknown,
      _options: { requiredToken: string },
    ): Promise<RowInterface | null> => null,
  },
})

defineView({
  // @ts-expect-error findOne must return the source document shape
  collection: {
    ...rowCollection,
    findOne: async () => ({ unrelated: true }),
  },
})

defineView({
  // @ts-expect-error absent documents must be null, matching the helper return type
  collection: {
    ...rowCollection,
    findOne: async (): Promise<RowInterface | undefined> => undefined,
  },
})

// Provider and method compatibility
defineView({ collection: () => rowCollection }).findOne({ _id: 1 })
defineView({ collection: async () => rowCollection }).findOne({ _id: 1 })

const requiredProjectionAdapter = defineView({
  collection: {
    ...rowCollection,
    findOne: async (
      _filter: Record<string, unknown>,
      _options: { projection: DocumentSelection | undefined },
    ): Promise<RowInterface | null> => null,
  },
})
// The helper supplies both arguments even when the caller supplies neither.
requiredProjectionAdapter.findOne()

// @ts-expect-error Views require a collection.
defineView({ populate: {} })
// @ts-expect-error Native collection types are preserved, including filters.
course.read((collection) => collection.findOne({ _id: 123 }))
// @ts-expect-error Selection values must be numeric literals.
defineView({ collection: courses, select: { title: true } })
// @ts-expect-error Views do not expose public populate map.
course.populate
// @ts-expect-error Views do not expose public select container.
course.select

// Broad, pre-annotated definitions remain accepted and are validated at runtime.
declare const annotated: ViewConfig
const broad = defineView(annotated)
broad.read((collection) => collection.find({}).toArray())

// Field names are not reserved on source schemas; actual cursors are rejected
// at runtime because the broad document-result boundary cannot identify them.
declare const namedFields: Collection<{ toArray: string; name: string }>
defineView({ collection: namedFields }).read((collection) => collection.findOne({}))

// Inline view configuration is accepted in populate
const inlineCourse = defineView({
  collection: Courses,
  populate: {
    reviewer: {
      collection: partners,
      select: { name: 1 },
    },
    parentOrg: {
      collection: partners,
      select: { name: 1 },
      foreignKey: 'name',
    },
    nested: {
      collection: partners,
      populate: {
        deep: {
          collection: partners,
        },
      },
    },
  },
})

defineView({
  collection: Courses,
  populate: {
    // @ts-expect-error Inline relations require a collection.
    invalid: { select: { name: 1 } },
    // @ts-expect-error Inline relations require a collection.
    invalidPopulate: { populate: { something: partner } },
    // @ts-expect-error Relation "view" must be a valid View or ViewConfig.
    invalidView: { view: null },
    // @ts-expect-error Misspelled foreignKey in inline relation.
    misspelledForeignKey: { collection: partners, foreignkey: 'code' },
    // @ts-expect-error Misspelled select in inline relation.
    misspelledSelect: { collection: partners, selct: { secret: 0 } },
    // @ts-expect-error Misspelled foreignKey in wrapped view.
    wrappedBadKey: { view: partner, foreignkey: 'code' },
    // @ts-expect-error Unknown option in wrapped view.
    wrappedUnknown: { view: partner, extraProp: 123 },
    nestedBad: {
      collection: partners,
      populate: {
        // @ts-expect-error Misspelled foreignKey in nested inline relation.
        deep: { collection: partners, foreignkey: 'code' },
      },
    },
    wrappedViewMisspelledOption: {
      // @ts-expect-error Misspelled option directly inside wrapped view config.
      view: { collection: partners, selct: { secret: 0 } },
    },
    wrappedViewNestedMisspelledOption: {
      view: {
        collection: partners,
        populate: {
          // @ts-expect-error Misspelled option inside wrapped view.populate.
          deep: { collection: partners, foreignkey: 'code' },
        },
      },
    },
  },
})

// Valid wrapped relation with actual View instance and valid wrapped ViewConfig
const validWrapped = defineView({
  collection: Courses,
  populate: {
    author: { view: partner, foreignKey: 'name' },
    reviewer: {
      view: {
        collection: partners,
        select: { name: 1 },
        populate: {
          team: { collection: partners },
        },
      },
      foreignKey: 'name',
    },
  },
})

// satisfies PopulateMap remains accepted
const reusablePartner = defineView({ collection: partners, select: { name: 1 } })
const satisfiesPopulate = {
  author: { collection: partners, foreignKey: 'name' },
  direct: reusablePartner,
  wrapped: { view: reusablePartner, foreignKey: 'name' },
} satisfies PopulateMap

defineView({
  collection: Courses,
  populate: satisfiesPopulate,
})

// Relation policies are accepted only on relation edges.
const unresolvedTarget = defineView({ collection: Users })
defineView({
  collection: Users,
  populate: { friend: { view: unresolvedTarget, onUnresolved: 'throw' } },
})
defineView({
  collection: Users,
  populate: { friend: { view: { collection: Users }, onUnresolved: 'filter' } },
})
defineView({
  collection: Users,
  populate: { friend: { collection: Users, onUnresolved: undefined } },
})
// @ts-expect-error Invalid policy literal.
defineView({ collection: Users, populate: { friend: { collection: Users, onUnresolved: 'omit' } } })
defineView({
  collection: Users,
  // @ts-expect-error Null does not select the default.
  populate: { friend: { view: unresolvedTarget, onUnresolved: null } },
})
// @ts-expect-error Misspelled inline relation option.
defineView({ collection: Users, populate: { friend: { collection: Users, onUnresolve: 'throw' } } })
defineView({
  collection: Users,
  // @ts-expect-error Misspelled wrapped relation option.
  populate: { friend: { view: unresolvedTarget, onUnresolve: 'throw' } },
})
// @ts-expect-error Policies belong to relations, not the root config.
defineView({ collection: Users, onUnresolved: 'throw' })
defineView({
  collection: Users,
  // @ts-expect-error Policies belong to the wrapper, not its target config.
  populate: { friend: { view: { collection: Users, onUnresolved: 'throw' } } },
})
const invalidOptionalPolicy: { onUnresolved?: 'omit' } = {}
defineView({
  collection: Users,
  // @ts-expect-error Optional policies also validate their values.
  populate: { friend: { view: unresolvedTarget, ...invalidOptionalPolicy } },
})
