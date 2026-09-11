// Compile-time checks for schema inference, projections, and populations.
// Assertions are checked by tsconfig; schema.test.ts also validates the view definitions.
import type { Collection, ObjectId } from 'mongodb'
import {
  defineView,
  type InferSchema,
  type View,
  type ViewDocument,
} from '../src/index.ts'
import type {
  ApplyPopulate,
  ApplyProjection,
  EffectiveSelection,
  MapLoaderResult,
} from '../src/types/schema.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

// ============================================================================
// Schema Fixtures
// ============================================================================

interface AuthorDoc {
  _id: string
  name: string
  handle?: string
  secret: boolean
}

interface TagDoc {
  _id: string
  label: string
  color?: string
}

interface OrgDoc {
  _id: string
  name: string
  parentOrgId?: string | null
  secret: boolean
}

interface UserDoc {
  _id: ObjectId
  email: string
  profile: {
    displayName: string
    bio?: string
    avatar?: string
  }
  address?: {
    street: string
    city: string
    zip: string
  }
  role: string
  secretToken: string
}

interface ArticleDoc {
  _id: number
  title: string
  content: string
  // Scalar relations
  authorId: string
  reviewerId?: string
  editorId?: string | null
  // Array relations
  tagIds: string[]
  reviewerIds?: string[]
  // Union of scalar, array, null
  contributors?: string | string[] | null
  // Nested subdocument relation
  metadata: {
    createdById: string
    approvedById?: string
  }
  // Array of subdocuments relation
  sections: {
    heading: string
    authorId: string
    reviewerId?: string
  }[]
  // Deeply nested arrays within arrays
  curriculum?: {
    modules: {
      lessons: {
        instructorId: string
      }[]
    }[]
  }[]
  published: boolean
  draftNotes: string
}

const mockCollection = {} as any
const authors: Collection<AuthorDoc> = mockCollection
const tags: Collection<TagDoc> = mockCollection
const orgs: Collection<OrgDoc> = mockCollection
const users: Collection<UserDoc> = mockCollection
const articles: Collection<ArticleDoc> = mockCollection

// ============================================================================
// 1. Projection (Select) Types
// ============================================================================

// 1.1 Undefined selection preserves all fields
const allAuthorsView = defineView({ collection: authors })
type Doc1_1 = typeof allAuthorsView extends View<infer D, any> ? D : never
type Test1_1 = Expect<Equal<Doc1_1, AuthorDoc>>

// 1.2 Inclusion selection with implied _id: 1
const authorSummary = defineView({
  collection: authors,
  select: { name: 1, handle: 1 },
})
type Doc1_2 = typeof authorSummary extends View<infer D, any> ? D : never
type Expected1_2 = { _id: string; name: string; handle?: string }
type Test1_2 = Expect<Equal<Doc1_2, Expected1_2>>

// 1.3 Inclusion selection with explicit _id: 0
const authorNameOnly = defineView({
  collection: authors,
  select: { _id: 0, name: 1 },
})
type Doc1_3 = typeof authorNameOnly extends View<infer D, any> ? D : never
type Expected1_3 = { name: string }
type Test1_3 = Expect<Equal<Doc1_3, Expected1_3>>

// 1.4 Inclusion selection with only _id: 1
const authorIdOnly = defineView({
  collection: authors,
  select: { _id: 1 },
})
type Doc1_4 = typeof authorIdOnly extends View<infer D, any> ? D : never
type Expected1_4 = { _id: string }
type Test1_4 = Expect<Equal<Doc1_4, Expected1_4>>

// 1.5 Exclusion selection (dropping secret)
const publicAuthor = defineView({
  collection: authors,
  select: { secret: 0 },
})
type Doc1_5 = typeof publicAuthor extends View<infer D, any> ? D : never
type Expected1_5 = { _id: string; name: string; handle?: string }
type Test1_5 = Expect<Equal<Doc1_5, Expected1_5>>

// 1.6 Exclusion selection of multiple fields including _id: 0
const strippedAuthor = defineView({
  collection: authors,
  select: { _id: 0, secret: 0 },
})
type Doc1_6 = typeof strippedAuthor extends View<infer D, any> ? D : never
type Expected1_6 = { name: string; handle?: string }
type Test1_6 = Expect<Equal<Doc1_6, Expected1_6>>

// 1.7 Subdocument projection: including nested fields
const userProfileOnly = defineView({
  collection: users,
  select: { 'profile.displayName': 1, email: 1 },
})
type Doc1_7 = typeof userProfileOnly extends View<infer D, any> ? D : never
type Expected1_7 = {
  _id: ObjectId
  email: string
  profile: { displayName: string }
}
type Test1_7 = Expect<Equal<Doc1_7, Expected1_7>>

// 1.8 Subdocument projection: excluding nested field
const userNoSecret = defineView({
  collection: users,
  select: { secretToken: 0, 'profile.avatar': 0 },
})
type Doc1_8 = typeof userNoSecret extends View<infer D, any> ? D : never
type Expected1_8 = {
  _id: ObjectId
  email: string
  profile: { displayName: string; bio?: string }
  address?: { street: string; city: string; zip: string }
  role: string
}
type Test1_8 = Expect<Equal<Doc1_8, Expected1_8>>

// 1.9 Exclusion selection with explicit _id: 1 retains non-excluded fields
const authorExcludeSecretWithId = defineView({
  collection: authors,
  select: { _id: 1, secret: 0 },
})
type Doc1_9 = typeof authorExcludeSecretWithId extends View<infer D, any> ? D : never
type Expected1_9 = { _id: string; name: string; handle?: string }
type Test1_9 = Expect<Equal<Doc1_9, Expected1_9>>

// ============================================================================
// 2. Population (Relations) Types
// ============================================================================

// 2.1 Required scalar reference -> TargetDoc | null
const tagSimpleView = defineView({
  collection: tags,
  select: { label: 1 },
})

const articleWithRequiredScalar = defineView({
  collection: articles,
  select: { title: 1, authorId: 1 },
  populate: {
    authorId: authorSummary,
  },
})
type Doc2_1 = typeof articleWithRequiredScalar extends View<infer D, any> ? D : never
type Expected2_1 = {
  _id: number
  title: string
  authorId: Expected1_2 | null
}
type Test2_1 = Expect<Equal<Doc2_1, Expected2_1>>

// 2.2 Optional scalar reference -> TargetDoc | null | undefined
const articleWithOptionalScalar = defineView({
  collection: articles,
  select: { title: 1, reviewerId: 1 },
  populate: {
    reviewerId: { view: authorNameOnly, foreignKey: 'name' },
  },
})
type Doc2_2 = typeof articleWithOptionalScalar extends View<infer D, any> ? D : never
type Expected2_2 = {
  _id: number
  title: string
  reviewerId?: Expected1_3 | null | undefined
}
type Test2_2 = Expect<Equal<Doc2_2, Expected2_2>>

// 2.3 Nullable scalar reference -> TargetDoc | null
const articleWithNullableScalar = defineView({
  collection: articles,
  select: { title: 1, editorId: 1 },
  populate: {
    editorId: { view: authorNameOnly, foreignKey: 'name' },
  },
})
type Doc2_3 = typeof articleWithNullableScalar extends View<infer D, any> ? D : never
type Expected2_3 = {
  _id: number
  title: string
  editorId?: Expected1_3 | null | undefined
}
type Test2_3 = Expect<Equal<Doc2_3, Expected2_3>>

// 2.4 Array of scalar references -> (TargetDoc | null)[]
const articleWithTagArray = defineView({
  collection: articles,
  select: { title: 1, tagIds: 1 },
  populate: {
    tagIds: tagSimpleView,
  },
})
type TagSimpleDoc = { _id: string; label: string }
type Doc2_4 = typeof articleWithTagArray extends View<infer D, any> ? D : never
type Expected2_4 = {
  _id: number
  title: string
  tagIds: (TagSimpleDoc | null)[]
}
type Test2_4 = Expect<Equal<Doc2_4, Expected2_4>>

// 2.5 Optional array of scalar references -> (TargetDoc | null)[] | undefined
const articleWithOptionalArray = defineView({
  collection: articles,
  select: { title: 1, reviewerIds: 1 },
  populate: {
    reviewerIds: authorSummary,
  },
})
type Doc2_5 = typeof articleWithOptionalArray extends View<infer D, any> ? D : never
type Expected2_5 = {
  _id: number
  title: string
  reviewerIds?: (Expected1_2 | null)[] | undefined
}
type Test2_5 = Expect<Equal<Doc2_5, Expected2_5>>

// 2.6 Union of scalar, array, and null -> distributions
const articleWithUnion = defineView({
  collection: articles,
  select: { title: 1, contributors: 1 },
  populate: {
    contributors: { view: authorNameOnly, foreignKey: 'name' },
  },
})
type Doc2_6 = typeof articleWithUnion extends View<infer D, any> ? D : never
type Expected2_6 = {
  _id: number
  title: string
  contributors?: Expected1_3 | (Expected1_3 | null)[] | null | undefined
}
type Test2_6 = Expect<Equal<Doc2_6, Expected2_6>>

// ============================================================================
// 3. Nested & Deep Dot-Path Populations
// ============================================================================

// 3.1 Subdocument paths: 'metadata.createdById'
const articleWithMetadataPopulate = defineView({
  collection: articles,
  select: { title: 1, metadata: 1 },
  populate: {
    'metadata.createdById': authorSummary,
    'metadata.approvedById': { view: authorNameOnly, foreignKey: 'name' },
  },
})
type Doc3_1 = typeof articleWithMetadataPopulate extends View<infer D, any> ? D : never
type Expected3_1 = {
  _id: number
  title: string
  metadata: {
    createdById: Expected1_2 | null
    approvedById?: Expected1_3 | null | undefined
  }
}
type Test3_1 = Expect<Equal<Doc3_1, Expected3_1>>

// 3.2 Array of subdocuments: 'sections.authorId'
const articleWithSectionsPopulate = defineView({
  collection: articles,
  select: { title: 1, sections: 1 },
  populate: {
    'sections.authorId': authorSummary,
    'sections.reviewerId': { view: authorNameOnly, foreignKey: 'name' },
  },
})
type Doc3_2 = typeof articleWithSectionsPopulate extends View<infer D, any> ? D : never
type Expected3_2 = {
  _id: number
  title: string
  sections: {
    heading: string
    authorId: Expected1_2 | null
    reviewerId?: Expected1_3 | null | undefined
  }[]
}
type Test3_2 = Expect<Equal<Doc3_2, Expected3_2>>

// 3.3 Deeply nested arrays: 'curriculum.modules.lessons.instructorId'
const articleWithDeepArray = defineView({
  collection: articles,
  select: { title: 1, curriculum: 1 },
  populate: {
    'curriculum.modules.lessons.instructorId': authorSummary,
  },
})
type Doc3_3 = typeof articleWithDeepArray extends View<infer D, any> ? D : never
type Expected3_3 = {
  _id: number
  title: string
  curriculum?:
    | {
        modules: {
          lessons: {
            instructorId: Expected1_2 | null
          }[]
        }[]
      }[]
    | undefined
}
type Test3_3 = Expect<Equal<Doc3_3, Expected3_3>>

// ============================================================================
// 4. Multi-Level (Transitive) Views & Inline Configurations
// ============================================================================

// 4.1 Transitive: Org -> Parent Org
const orgSummary = defineView({
  collection: orgs,
  select: { name: 1, parentOrgId: 1 },
})

const orgDetail = defineView({
  collection: orgs,
  select: { name: 1, parentOrgId: 1 },
  populate: {
    parentOrgId: { view: orgSummary, foreignKey: '_id' },
  },
})
type OrgSummaryDoc = { _id: string; name: string; parentOrgId?: string | null }
type OrgDetailDoc = { _id: string; name: string; parentOrgId?: OrgSummaryDoc | null | undefined }
type Doc4_1 = typeof orgDetail extends View<infer D, any> ? D : never
type Test4_1 = Expect<Equal<Doc4_1, OrgDetailDoc>>

// 4.2 Inline relation configuration
const articleWithInlineView = defineView({
  collection: articles,
  select: { title: 1, authorId: 1 },
  populate: {
    authorId: {
      collection: authors,
      select: { _id: 0, name: 1, handle: 1 },
      foreignKey: 'name',
    },
  },
})
type Doc4_2 = typeof articleWithInlineView extends View<infer D, any> ? D : never
type Expected4_2 = {
  _id: number
  title: string
  authorId: { name: string; handle?: string } | null
}
type Test4_2 = Expect<Equal<Doc4_2, Expected4_2>>

// 4.3 Nested inline view configuration
const articleWithNestedInline = defineView({
  collection: articles,
  select: { title: 1, authorId: 1 },
  populate: {
    authorId: {
      collection: authors,
      select: { name: 1, handle: 1 },
      populate: {
        handle: {
          collection: authors,
          select: { _id: 0, handle: 1 },
          foreignKey: 'handle',
        },
      },
    },
  },
})
type Doc4_3 = typeof articleWithNestedInline extends View<infer D, any> ? D : never
type Expected4_3 = {
  _id: number
  title: string
  authorId: { _id: string; name: string; handle?: { handle?: string } | null | undefined } | null
}
type Test4_3 = Expect<Equal<Doc4_3, Expected4_3>>

// ============================================================================
// 5. view.read() Loader Return Types & Type Narrowing
// ============================================================================

async function testReadOperations() {
  // 5.1 toArray() produces array of view documents
  const allArticles = await articleWithSectionsPopulate.read((col, { projection }) =>
    col.find({ published: true }, { projection }).toArray(),
  )
  type TestReadArray = Expect<Equal<typeof allArticles, Expected3_2[]>>

  // 5.2 findOne() produces nullable view document
  const oneArticle = await articleWithSectionsPopulate.read((col, { projection }) =>
    col.findOne({ _id: 10 }, { projection }),
  )
  type TestReadOne = Expect<Equal<typeof oneArticle, Expected3_2 | null>>

  // 5.3 Tuples are traversed as arrays and retain their element positions
  const tuple = await articleWithSectionsPopulate.read(
    async (col, { projection }) => [await col.find({}, { projection }).toArray(), 100] as const,
  )
  type TestReadonlyTuple = Expect<Equal<typeof tuple, readonly [Expected3_2[], 100]>>

  const mutableTuple = await articleWithSectionsPopulate.read(async (col, { projection }) => {
    const result: [ArticleDoc[], number] = [await col.find({}, { projection }).toArray(), 100]
    return result
  })
  type TestMutableTuple = Expect<Equal<typeof mutableTuple, [Expected3_2[], number]>>

  // 5.4 Null checks and field access validation
  if (oneArticle) {
    const title: string = oneArticle.title

    // First section author
    const firstSection = oneArticle.sections[0]
    if (firstSection) {
      // @ts-expect-error authorId can be null when populate yields no match
      const rawAuthor: Expected1_2 = firstSection.authorId

      if (firstSection.authorId) {
        const authorName: string = firstSection.authorId.name
        // @ts-expect-error secret was not selected on authorSummary
        const authorSecret = firstSection.authorId.secret
      }
    }

    // @ts-expect-error draftNotes was not selected on articleWithSectionsPopulate
    const notes = oneArticle.draftNotes
    // @ts-expect-error authorId was not selected on articleWithSectionsPopulate
    const rawArticleAuthor = oneArticle.authorId
  }

  // 5.5 find() produces array of view documents
  const foundArticles = await articleWithSectionsPopulate.find(
    { published: true },
    { sort: { title: 1 }, limit: 10 },
  )
  type TestFindArray = Expect<Equal<typeof foundArticles, Expected3_2[]>>

  // 5.6 findOne() produces nullable view document
  const foundOneArticle = await articleWithSectionsPopulate.findOne({ _id: 10 })
  type TestFindOne = Expect<Equal<typeof foundOneArticle, Expected3_2 | null>>

  // 5.7 find() with default args
  const defaultFound = await articleWithSectionsPopulate.find()
  type TestFindDefault = Expect<Equal<typeof defaultFound, Expected3_2[]>>

  // 5.8 Option constraints: projection, explain, raw, returnKey are forbidden
  // @ts-expect-error projection option is forbidden
  await articleWithSectionsPopulate.find({}, { projection: { title: 1 } })
  // @ts-expect-error explain option is forbidden
  await articleWithSectionsPopulate.find({}, { explain: true })
  // @ts-expect-error raw option is forbidden
  await articleWithSectionsPopulate.find({}, { raw: true })
  // @ts-expect-error returnKey option is forbidden
  await articleWithSectionsPopulate.find({}, { returnKey: true })

  // 5.9 Source schema filtering: filter by unprojected source field (e.g. draftNotes)
  await articleWithSectionsPopulate.find({ draftNotes: 'Secret Draft' })
  // @ts-expect-error invalid filter field type
  await articleWithSectionsPopulate.find({ _id: 'not-a-number' })
}

// ============================================================================
// 6. Isolated Type Utility Tests
// ============================================================================

// 6.1 Projection on bare types
type Test6_1a = Expect<
  Equal<ApplyProjection<UserDoc, { email: 1 }>, { _id: ObjectId; email: string }>
>
type Test6_1b = Expect<
  Equal<ApplyProjection<AuthorDoc, { _id: 0 }>, { name: string; handle?: string; secret: boolean }>
>
type Test6_1c = Expect<Equal<ApplyProjection<AuthorDoc, {}>, AuthorDoc>>
type Test6_1d = Expect<Equal<ApplyProjection<AuthorDoc, undefined>, AuthorDoc>>

// 6.2 Population on bare types
type Test6_2a = Expect<
  Equal<
    ApplyPopulate<
      { _id: number; authorId: string; title: string },
      { authorId: View<{ name: string }, any> }
    >,
    { _id: number; authorId: { name: string } | null; title: string }
  >
>

// 6.3 Readonly arrays preserved through population
interface ReadonlyRefsDoc {
  _id: string
  refs: readonly string[]
}
type Test6_3 = Expect<
  Equal<
    ApplyPopulate<ReadonlyRefsDoc, { refs: View<{ label: string }, any> }>,
    { _id: string; refs: readonly ({ label: string } | null)[] }
  >
>

// 6.4 Mutable arrays stay mutable through population
interface MutableRefsDoc {
  _id: string
  refs: string[]
}
type Test6_4 = Expect<
  Equal<
    ApplyPopulate<MutableRefsDoc, { refs: View<{ label: string }, any> }>,
    { _id: string; refs: ({ label: string } | null)[] }
  >
>

// 6.5 Nested array projection
interface PostWithSections {
  _id: number
  sections: {
    heading: string
    body: string
  }[]
}
type Test6_5 = Expect<
  Equal<
    ApplyProjection<PostWithSections, { 'sections.heading': 1 }>,
    { _id: number; sections: { heading: string }[] }
  >
>

// 6.6 Subdocument projection eliminates subdocument _id
interface SubdocWithId {
  _id: string
  profile: {
    _id: string
    name: string
  }
}
type Test6_6 = Expect<
  Equal<
    ApplyProjection<SubdocWithId, { 'profile.name': 1 }>,
    { _id: string; profile: { name: string } }
  >
>

// 6.7 Composite root _id subfield projection
interface CompositeIdSchema {
  _id: { a: number; b: string }
  name: string
}
type Test6_7 = Expect<
  Equal<ApplyProjection<CompositeIdSchema, { '_id.a': 1 }>, { _id: { a: number } }>
>

// 6.8 Optional _id in schema produces required _id
interface OptionalIdSchema {
  _id?: string
  name: string
}
const optionalIdCollection: Collection<OptionalIdSchema> = mockCollection
type Test6_8 = Expect<
  Equal<InferSchema<typeof optionalIdCollection>, { _id: string; name: string }>
>

// 6.9 Consecutive nested arrays in population and projection
interface MultiDimDoc {
  _id: string
  matrix: { authorId: string }[][]
}
type Test6_9a = Expect<
  Equal<
    ApplyPopulate<MultiDimDoc, { 'matrix.authorId': typeof authorSummary }>,
    { _id: string; matrix: { authorId: Expected1_2 | null }[][] }
  >
>
type Test6_9b = Expect<
  Equal<
    ApplyProjection<{ _id: string; matrix: { a: number; b: string }[][] }, { 'matrix.a': 1 }>,
    { _id: string; matrix: { a: number }[][] }
  >
>

// 6.10 _id-only schema read infers array, not single document
interface IdOnlyDoc {
  _id: string
}
const idOnlyCol: Collection<IdOnlyDoc> = mockCollection
const idOnlyView = defineView({ collection: idOnlyCol })
async function testIdOnlyRead() {
  const items = await idOnlyView.read((col) => col.find({}).toArray())
  type Test6_10 = Expect<Equal<typeof items, IdOnlyDoc[]>>

  const count = await idOnlyView.read(() => 42)
  type TestIdOnlyCount = Expect<Equal<typeof count, number>>
}

// 6.11 Loader results without _id preserve optional source fields during matching
const articleWithoutId = defineView({
  collection: articles,
  select: { _id: 0, title: 1, reviewerId: 1 },
  populate: { reviewerId: authorSummary },
})
async function testIdlessRead() {
  const items = await articleWithoutId.read((col, { projection }) =>
    col.find<Omit<ArticleDoc, '_id'>>({}, { projection }).toArray(),
  )
  type TestIdlessRead = Expect<
    Equal<typeof items, { title: string; reviewerId?: Expected1_2 | null }[]>
  >
}

// 6.12 Object wrappers and their atomic values are not recursively transformed
type LoaderWrapper = {
  items: ArticleDoc[]
  total: number
  createdAt: Date
  cursorId: ObjectId
  format: () => string
}
type TestUnchangedWrapper = Expect<
  Equal<MapLoaderResult<LoaderWrapper, ArticleDoc, Expected3_2>, LoaderWrapper>
>
type TestUnchangedDate = Expect<Equal<MapLoaderResult<Date, ArticleDoc, Expected3_2>, Date>>
type TestPrimitiveWithMatchingProperty = Expect<
  Equal<MapLoaderResult<string, { _id: string; length: number }, { length: number }>, string>
>
type TestFunctionWithMatchingProperty = Expect<
  Equal<
    MapLoaderResult<() => number, { _id: string; name: string }, { name: string }>,
    () => number
  >
>
class LoaderConstructor {}
type TestConstructorWithMatchingProperty = Expect<
  Equal<
    MapLoaderResult<typeof LoaderConstructor, { _id: string; name: string }, { name: string }>,
    typeof LoaderConstructor
  >
>

// 6.13 Native schemas and providers follow the driver's _id inference
type TestImplicitId = Expect<
  Equal<InferSchema<Collection<{ name: string }>>, { _id: ObjectId; name: string }>
>
type TestReadonlySourceId = Expect<
  Equal<
    InferSchema<Collection<{ readonly _id: string; name: string }>>,
    { _id: string; name: string }
  >
>
type TestSyncSchemaProvider = Expect<
  Equal<InferSchema<() => Collection<OptionalIdSchema>>, { _id: string; name: string }>
>
type TestAsyncSchemaProvider = Expect<
  Equal<InferSchema<() => Promise<Collection<OptionalIdSchema>>>, { _id: string; name: string }>
>
type TestStructuralCollectionSchema = Expect<
  Equal<
    InferSchema<{
      find(): { toArray(): Promise<{ key: string }[]> }
      findOne(): Promise<{ key: string } | null>
    }>,
    { key: string }
  >
>

// ============================================================================
// 7. Implicit Inclusion Types
// ============================================================================

// 7.1 View with inclusive select { title: 1 } and populate: { authorId: authorSummary }
// authorId is implicitly added to selection without explicit duplication in select
const articleImplicitSelect = defineView({
  collection: articles,
  select: { title: 1 },
  populate: { authorId: authorSummary },
})

type Doc7_1 = typeof articleImplicitSelect extends View<infer D, any> ? D : never
type Expected7_1 = {
  _id: number
  title: string
  authorId: Expected1_2 | null
}
type Test7_1 = Expect<Equal<Doc7_1, Expected7_1>>

// Verify that unselected fields are excluded from the type
async function testImplicitTypeChecks(doc: Doc7_1) {
  const title: string = doc.title
  const author = doc.authorId
  // @ts-expect-error draftNotes was not selected
  const draft = doc.draftNotes
  // @ts-expect-error content was not selected
  const content = doc.content
}

// 7.2 Nested populate path 'sections.authorId' with inclusive select { title: 1 }
const articleImplicitNested = defineView({
  collection: articles,
  select: { title: 1 },
  populate: { 'sections.authorId': authorSummary },
})

type Doc7_2 = typeof articleImplicitNested extends View<infer D, any> ? D : never
type Expected7_2 = {
  _id: number
  title: string
  sections: {
    authorId: Expected1_2 | null
  }[]
}
type Test7_2 = Expect<Equal<Doc7_2, Expected7_2>>

// 7.3 Omitted select preserves all fields and does not treat populates as an inclusive projection
const articleImplicitOmitted = defineView({
  collection: articles,
  populate: { authorId: authorSummary },
})

type Doc7_3 = typeof articleImplicitOmitted extends View<infer D, any> ? D : never
async function testOmittedSelectTypes(doc: Doc7_3) {
  const title: string = doc.title
  const draft: string = doc.draftNotes
  const content: string = doc.content
  const author: Expected1_2 | null = doc.authorId
}

// 7.4 Exclusive select { draftNotes: 0 } preserves all non-excluded fields and populates authorId
const articleImplicitExclusion = defineView({
  collection: articles,
  select: { draftNotes: 0 },
  populate: { authorId: authorSummary },
})

type Doc7_4 = typeof articleImplicitExclusion extends View<infer D, any> ? D : never
async function testExclusionSelectTypes(doc: Doc7_4) {
  const title: string = doc.title
  const content: string = doc.content
  const author: Expected1_2 | null = doc.authorId
  // @ts-expect-error draftNotes was excluded by selection
  const draft = doc.draftNotes
}

interface SimplePostDoc {
  _id: string
  title: string
  authorId: string
}
const simplePosts: Collection<SimplePostDoc> = mockCollection

const simpleImplicitView = defineView({
  collection: simplePosts,
  select: { title: 1 },
  populate: { authorId: authorSummary },
})
type Doc7_Simple = typeof simpleImplicitView extends View<infer D, any> ? D : never
type Expected7_Simple = {
  _id: string
  title: string
  authorId: Expected1_2 | null
}
type Test7_Simple = Expect<Equal<Doc7_Simple, Expected7_Simple>>

// 7.5 EffectiveSelection standalone utility tests
type TestEff1 = Expect<
  Equal<EffectiveSelection<{ title: 1 }, { authorId: any }>, { title: 1 } & { authorId: 1 }>
>
type TestEff2 = Expect<Equal<EffectiveSelection<undefined, { authorId: any }>, undefined>>
type TestEff3 = Expect<Equal<EffectiveSelection<{ secret: 0 }, { authorId: any }>, { secret: 0 }>>
type TestEff4 = Expect<Equal<EffectiveSelection<{ _id: 0 }, { authorId: any }>, { _id: 0 }>>

// 7.6 Less-specific selection takes precedence over more-specific population:
// select: { item: 1 } with populate: { 'item.user': authorSummary } retains all fields of item
interface NestedContainerDoc {
  _id: string
  title: string
  item: {
    user: string
    label: string
    extra: boolean
  }
}
const nestedContainers: Collection<NestedContainerDoc> = mockCollection

const nestedContainerView = defineView({
  collection: nestedContainers,
  select: { item: 1 },
  populate: { 'item.user': authorSummary },
})
type Doc7_Container = typeof nestedContainerView extends View<infer D, any> ? D : never
type Expected7_Container = {
  _id: string
  item: {
    user: Expected1_2 | null
    label: string
    extra: boolean
  }
}
type Test7_Container = Expect<Equal<Doc7_Container, Expected7_Container>>

// 7.7 Explicit exclusions filter out populate paths from implicit inclusion:
// With select: { _id: 0, title: 1 }:
// a) populate: { _id: authorSummary } does not make document type never
const excludedIdView = defineView({
  collection: simplePosts,
  select: { _id: 0, title: 1 },
  populate: { _id: authorSummary },
})
type Doc7_ExcludedId = typeof excludedIdView extends View<infer D, any> ? D : never
type Expected7_ExcludedId = { title: string }
type Test7_ExcludedId = Expect<Equal<Doc7_ExcludedId, Expected7_ExcludedId>>

// b) populate: { '_id.owner': authorSummary } does not expose _id or _id.owner
const excludedIdAncestorView = defineView({
  collection: simplePosts,
  select: { _id: 0, title: 1 },
  populate: { '_id.owner': authorSummary },
})
type Doc7_ExcludedIdAncestor = typeof excludedIdAncestorView extends View<infer D, any> ? D : never
type Expected7_ExcludedIdAncestor = { title: string }
type Test7_ExcludedIdAncestor = Expect<Equal<Doc7_ExcludedIdAncestor, Expected7_ExcludedIdAncestor>>

// 7.8 EffectiveSelection unit tests for explicit exclusion filtering
type TestEffExcludedDirect = Expect<
  Equal<EffectiveSelection<{ _id: 0; title: 1 }, { _id: any }>, { _id: 0; title: 1 }>
>
type TestEffExcludedAncestor = Expect<
  Equal<EffectiveSelection<{ _id: 0; title: 1 }, { '_id.owner': any }>, { _id: 0; title: 1 }>
>
type TestEffExcludedNonMatching = Expect<
  Equal<
    EffectiveSelection<{ _id: 0; title: 1 }, { authorId: any }>,
    { _id: 0; title: 1 } & { authorId: 1 }
  >
>

// Unresolved policies preserve source nullability and ancestor containers.
import type { PopulateUnresolvedPolicy, PopulateMap } from '../src/index.ts'
import type { PopulateField } from '../src/types/schema.ts'
type PolicyDoc = { _id: string }
type PolicyFieldChecks = [
  Expect<Equal<PopulateField<string, PolicyDoc>, PolicyDoc | null>>,
  Expect<Equal<PopulateField<string, PolicyDoc, 'filter'>, PolicyDoc | null>>,
  Expect<Equal<PopulateField<string, PolicyDoc, 'throw'>, PolicyDoc>>,
  Expect<
    Equal<
      PopulateField<string | null | undefined, PolicyDoc, 'throw'>,
      PolicyDoc | null | undefined
    >
  >,
  Expect<Equal<PopulateField<null, PolicyDoc, 'throw'>, null>>,
  Expect<Equal<PopulateField<string[], PolicyDoc>, (PolicyDoc | null)[]>>,
  Expect<Equal<PopulateField<string[] | null, PolicyDoc, 'filter'>, PolicyDoc[] | null>>,
  Expect<Equal<PopulateField<string[] | null, PolicyDoc, 'throw'>, PolicyDoc[] | null>>,
  Expect<Equal<PopulateField<(string | null | undefined)[], PolicyDoc, 'filter'>, PolicyDoc[]>>,
  Expect<
    Equal<PopulateField<(string | null | undefined)[], PolicyDoc, 'throw'>, (PolicyDoc | null)[]>
  >,
  Expect<Equal<PopulateField<readonly string[], PolicyDoc, 'throw'>, readonly PolicyDoc[]>>,
  Expect<
    Equal<
      PopulateField<readonly (string | undefined)[], PolicyDoc, 'throw'>,
      readonly (PolicyDoc | null)[]
    >
  >,
  Expect<Equal<PopulateField<string[], PolicyDoc, PopulateUnresolvedPolicy>, (PolicyDoc | null)[]>>,
  Expect<Equal<PopulateField<string[], PolicyDoc, 'filter' | 'throw'>, PolicyDoc[]>>,
  Expect<
    Equal<PopulateField<(string | null)[], PolicyDoc, 'filter' | 'throw'>, (PolicyDoc | null)[]>
  >,
  Expect<Equal<PopulateField<string[], unknown, 'throw'>, unknown[]>>,
  Expect<Equal<PopulateField<string[], any, 'filter'>, any[]>>,
  Expect<Equal<PopulateField<unknown[], PolicyDoc, 'throw'>, (PolicyDoc | null)[]>>,
  Expect<Equal<PopulateField<any[], PolicyDoc, 'throw'>, (PolicyDoc | null)[]>>,
]
type PolicySource = {
  ref: string
  ids?: readonly string[]
  sections: ({ ids: string[] } | null)[] | null
}
type PolicyTarget = View<PolicyDoc>
type OptionalPolicyChecks = [
  Expect<
    Equal<
      ApplyPopulate<{ ids: string[] }, { ids: { view: PolicyTarget; onUnresolved?: 'throw' } }>,
      { ids: (PolicyDoc | null)[] }
    >
  >,
  Expect<
    Equal<
      ApplyPopulate<{ ref: string }, { ref: { view: PolicyTarget; onUnresolved?: 'throw' } }>,
      { ref: PolicyDoc | null }
    >
  >,
  Expect<
    Equal<
      ApplyPopulate<{ ids: string[] }, { ids: { view: PolicyTarget; onUnresolved: undefined } }>,
      { ids: (PolicyDoc | null)[] }
    >
  >,
  Expect<
    Equal<
      ApplyPopulate<
        { ids: string[] },
        { ids: PolicyTarget | { view: PolicyTarget; onUnresolved: 'throw' } }
      >,
      { ids: (PolicyDoc | null)[] }
    >
  >,
  Expect<
    Equal<
      ApplyPopulate<
        PolicySource,
        {
          ids: { view: PolicyTarget; onUnresolved: 'filter' }
          'sections.ids': { view: PolicyTarget; onUnresolved: 'throw' }
        }
      >,
      { ref: string; ids?: readonly PolicyDoc[]; sections: ({ ids: PolicyDoc[] } | null)[] | null }
    >
  >,
]
const policySources: Collection<PolicySource> = mockCollection
const policyTargets: Collection<PolicyDoc> = mockCollection
const policyTarget = defineView({ collection: policyTargets })
const policyEntries = {
  ref: { view: policyTarget, onUnresolved: 'throw' },
  ids: { view: { collection: policyTargets }, onUnresolved: 'filter' },
  'sections.ids': { collection: policyTargets, onUnresolved: 'throw' },
} satisfies PopulateMap
const policyView = defineView({ collection: policySources, populate: policyEntries })
type PolicyInferred = typeof policyView extends View<infer D, any> ? D : never
type PolicyInferenceCheck = Expect<
  Equal<
    PolicyInferred,
    {
      _id: ObjectId
      ref: PolicyDoc
      ids?: readonly PolicyDoc[]
      sections: ({ ids: PolicyDoc[] } | null)[] | null
    }
  >
>
type PolicyRootNull = Expect<
  Equal<Awaited<ReturnType<typeof policyView.findOne>>, PolicyInferred | null>
>
const optionalPolicy: { onUnresolved?: 'throw' } = {}
const optionalPolicyView = defineView({
  collection: policySources,
  populate: {
    ref: { view: policyTarget, ...optionalPolicy },
    ids: { collection: policyTargets, ...optionalPolicy },
  },
})
type OptionalPolicyInferred = typeof optionalPolicyView extends View<infer D, any> ? D : never
type OptionalPolicyInferenceCheck = Expect<Equal<OptionalPolicyInferred['ref'], PolicyDoc | null>>
type OptionalArrayPolicyInferenceCheck = Expect<
  Equal<OptionalPolicyInferred['ids'], readonly (PolicyDoc | null)[] | undefined>
>
const broadPolicy = 'filter' as PopulateUnresolvedPolicy
const unionPolicy = 'filter' as 'filter' | 'throw'
const broadPolicyView = defineView({
  collection: policySources,
  populate: {
    ids: { collection: policyTargets, onUnresolved: broadPolicy },
    ref: { view: policyTarget, onUnresolved: unionPolicy },
  },
})
type BroadPolicyDoc = typeof broadPolicyView extends View<infer D, any> ? D : never
type BroadPolicyChecks = [
  Expect<Equal<BroadPolicyDoc['ids'], readonly (PolicyDoc | null)[] | undefined>>,
  Expect<Equal<BroadPolicyDoc['ref'], PolicyDoc | null>>,
]
const nestedPolicyView = defineView({
  collection: policySources,
  populate: {
    ref: {
      collection: policySources,
      onUnresolved: 'throw',
      populate: {
        ids: { view: policyTarget, onUnresolved: 'filter' },
      },
    },
  },
})
type NestedPolicyDoc = typeof nestedPolicyView extends View<infer D, any> ? D : never
type NestedPolicyCheck = Expect<
  Equal<NestedPolicyDoc['ref']['ids'], readonly PolicyDoc[] | undefined>
>
