# mongodb-extras

TypeScript projection inference and reference population for the native MongoDB Node.js driver.

Define reusable queries with typed projections and populated relations, without Mongoose or an ORM. Use your existing MongoDB collections, filters, and sessions.

[Documentation](https://cboar.github.io/mongodb-extras/) · [npm package](https://www.npmjs.com/package/mongodb-extras) · [GitHub](https://github.com/cboar/mongodb-extras)

## Install

```sh
npm install mongodb-extras mongodb
```

## Define a MongoDB view

Start with typed MongoDB collections, then describe the fields and relations each query should return.

```ts
import { MongoClient, ObjectId } from 'mongodb'
import { defineView } from 'mongodb-extras'

interface User {
  _id: ObjectId
  name: string
  email: string
}

interface Article {
  _id: ObjectId
  title: string
  body: string
  status: 'draft' | 'published'
  publishedAt?: Date
  authorId: ObjectId
  reviewerIds: ObjectId[]
}

const client = new MongoClient(process.env.MONGODB_URI!)
const db = client.db('example')

const users = db.collection<User>('users')
const articles = db.collection<Article>('articles')

const userPreview = defineView({
  collection: users,
  select: { name: 1 },
})

const articlePreview = defineView({
  collection: articles,
  select: { title: 1, status: 1, publishedAt: 1 },
  populate: {
    authorId: userPreview,
    reviewerIds: userPreview,
  },
})
```

Populated paths are included automatically when you use an inclusion projection, so `authorId` and `reviewerIds` do not need to be repeated in `select`.

## TypeScript projection inference

TypeScript infers selected fields and populated relations from the view:

```ts
const preview = await articlePreview.findOne({ status: 'published' })

preview?.title // string | undefined
preview?.authorId?.name // string | undefined
// body and authorId.email are omitted by the projections.
```

## Query MongoDB collections

### Find documents

`find` accepts a native MongoDB filter and familiar find options. It returns a materialized array with the view's projection and relations applied.

```ts
const recentArticles = await articlePreview.find(
  { status: 'published' },
  {
    sort: { publishedAt: -1 },
    limit: 20,
  },
)

for (const article of recentArticles) {
  console.log(article.title)
  console.log(article.authorId?.name)
  console.log(article.reviewerIds.map((reviewer) => reviewer?.name))
}
```

Missing relation matches become `null`, including individual entries in reference arrays. Array order and duplicate references are preserved.

Filters are checked against the source collection schema, including fields omitted from the returned view.

```ts
const articlesByUser = await articlePreview.find({
  authorId: new ObjectId('66d8f6d44d0f85c66a813df0'),
  status: 'published',
})
```

Call `find()` without arguments to retrieve all documents represented by the view.

```ts
const allArticles = await articlePreview.find()
```

Use native options such as `sort`, `skip`, `limit`, `collation`, or `session` as needed. The view owns its projection, so pass selected fields to `defineView` rather than supplying a `projection` option to `find`.

Find options apply only to the root collection query, except for `session`, which is also passed to every relation query. For other driver operations, such as an aggregation, use [`read`](https://cboar.github.io/mongodb-extras/projections/#customize-a-read).

### Find one document

`findOne` applies the same projection and population rules and returns `null` when no document matches.

```ts
const article = await articlePreview.findOne({
  _id: new ObjectId('66d8f70a4d0f85c66a813df1'),
})

if (article) {
  console.log(article.title)
  console.log(article.authorId?.name)
}
```

Sorting can select one document from a broader filter.

```ts
const latestArticle = await articlePreview.findOne(
  { status: 'published' },
  { sort: { publishedAt: -1 } },
)
```

### Find documents in ID order

Use `findByIds` to return documents in input order. Duplicates repeat, and missing IDs become `null`:

```ts
const orderedArticles = await articlePreview.findByIds([secondId, missingId, firstId, secondId])
// [secondArticle, null, firstArticle, secondArticle]

const foundArticles = orderedArticles.filter((doc) => doc !== null)
```

## Populate MongoDB references

Use `populate` to resolve references through other views.

### Nested documents and arrays

Use dot-notation for references inside embedded documents and arrays.

```ts
interface Conference {
  _id: ObjectId
  name: string
  sessions: Array<{
    title: string
    speakerId: ObjectId
  }>
}

const conferences = db.collection<Conference>('conferences')

const conferenceView = defineView({
  collection: conferences,
  select: { name: 1, sessions: 1 },
  populate: {
    'sessions.speakerId': userPreview,
  },
})

const conference = await conferenceView.findOne({
  _id: new ObjectId('66d8f7684d0f85c66a813df2'),
})

console.log(conference?.sessions[0]?.speakerId?.name)
```

### Custom foreign keys

Relations match `_id` by default. Set `foreignKey` when a stored reference targets another field.

```ts
interface Publisher {
  _id: ObjectId
  code: string
  name: string
}

interface Book {
  _id: ObjectId
  title: string
  publisherCode: string
}

const publishers = db.collection<Publisher>('publishers')
const books = db.collection<Book>('books')

const bookView = defineView({
  collection: books,
  select: { title: 1 },
  populate: {
    publisherCode: {
      collection: publishers,
      select: { code: 1, name: 1 },
      foreignKey: 'code',
    },
  },
})

const availableBooks = await bookView.find(
  { publisherCode: 'northwind' },
  { sort: { title: 1 } },
)

const book = await bookView.findOne({ title: 'The Long Way Home' })

console.log(availableBooks[0]?.publisherCode?.name)
console.log(book?.publisherCode?.name)
```

### Missing references

Set `onUnresolved` to configure how missing relation targets are handled:

```ts
const articleView = defineView({
  collection: articles,
  populate: {
    authorId: { view: userPreview, onUnresolved: 'throw' },
    reviewerIds: { view: userPreview, onUnresolved: 'filter' },
  },
})
```

- `'null'` (default) replaces unresolved references with `null`.
- `'filter'` removes unresolved matches and any existing nullish values from reference arrays.
- `'throw'` throws a `PopulateUnresolvedError` if a reference cannot be resolved.

See the [inferred types for each policy](https://cboar.github.io/mongodb-extras/population/#choose-how-unresolved-references-behave).

### Filter populated references

Use `filter` to limit populated targets. It can match fields the target view does not select:

```ts
populate: {
  reviewerIds: {
    view: userPreview,
    filter: { email: { $ne: 'hidden@example.com' } },
    onUnresolved: 'filter',
  },
}
```

## Reuse query views

A view can be shared across queries and composed into other views.

```ts
const articleListItem = defineView({
  collection: articles,
  select: { title: 1, publishedAt: 1 },
  populate: { authorId: userPreview },
})

const homepageArticles = await articleListItem.find(
  { status: 'published' },
  { sort: { publishedAt: -1 }, limit: 6 },
)

const featuredArticle = await articleListItem.findOne({
  _id: new ObjectId('66d8f70a4d0f85c66a813df1'),
})
```

To define views that differ by a few fields, [share a base configuration](https://cboar.github.io/mongodb-extras/population/#share-a-view-configuration).

## Compatibility

`mongodb-extras` is ESM-only, requires Node.js 20 or newer, and supports MongoDB Node.js driver 6 and 7 (`mongodb ^6.0.0 || ^7.0.0`).
