# mongodb-extras

Typed, reusable MongoDB queries with declarative projections and populated relations.

The MongoDB Node.js driver is deliberately low-level: it does not provide reusable result views or populate document references. `mongodb-extras` bridges those gaps without requiring an ODM or replacing the native driver.

## Install

```sh
npm install mongodb-extras mongodb
```

## Define a view

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

## Find documents

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

Find options apply only to the root collection query, except for `session`, which is propagated to every relation query. This keeps the complete populated read in the same transaction.

## Find one document

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

## Populate nested references

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

## Match a different key

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

## Control unresolved references

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

## Reuse views

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

`mongodb-extras` is ESM-only, requires Node.js 20 or newer, and supports MongoDB Node.js driver 6 and 7 (`mongodb ^6.0.0 || ^7.0.0`).
