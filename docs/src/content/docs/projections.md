---
title: MongoDB projections and typed queries
description: Infer TypeScript result types from MongoDB projections, query reusable views, preserve ID order, and use sessions or custom loaders.
---

The examples below use the collections and views from
[getting started](/mongodb-extras/). A view owns its projection; each query
supplies the filter and read options.

## Select the returned fields

Use `1` to include fields or `0` to exclude them. MongoDB retains `_id` unless you
explicitly exclude it. Omitting `select` returns all source fields.

```ts
const articleTitle = defineView({
  collection: articles,
  select: { _id: 0, title: 1 },
})

const articleWithoutBody = defineView({
  collection: articles,
  select: { body: 0 },
})

const title = await articleTitle.findOne()
console.log(title?.title) // string | undefined
// title has neither _id nor body.
```

Keep inclusions and exclusions separate, except for `_id`. Dot notation selects
nested fields, such as `select: { 'profile.displayName': 1 }`. Projection acceptance
and validation follow MongoDB's rules.

Keep shared selections literal so TypeScript can infer their exact keys and values:

```ts
const listFields = { title: 1, publishedAt: 1 } as const
const articleList = defineView({ collection: articles, select: listFields })
```

For grouped nested selections, `prefixKeys` adds a dot-separated prefix while
preserving literal types:

```ts
import { prefixKeys } from 'mongodb-extras'

const profileFields = prefixKeys('profile', { displayName: 1, avatar: 1 })
// { 'profile.displayName': 1, 'profile.avatar': 1 }
```

## Reuse the inferred document type

```ts
import type { InferViewDocument } from 'mongodb-extras'

type ArticlePreview = InferViewDocument<typeof articlePreview>

function authorName(article: ArticlePreview): string {
  return article.authorId?.name ?? 'Unknown author'
}
```

Inference comes from your collection schema, selection, and population settings.
It does not validate stored documents at runtime.

## Find documents

`find(filter?, options?)` returns a materialized array, rather than a cursor:

```ts
const page = await articlePreview.find(
  { status: 'published', body: { $ne: '' } },
  { sort: { publishedAt: -1 }, skip: 20, limit: 20 },
)
```

Filters use the source schema, so they can reference fields omitted from the
result. `find()` with no arguments retrieves all documents through the view;
use a limit or filter when reading large collections.

`findOne(filter?, options?)` returns one document or `null`. Sorting can choose a
document from several matches:

```ts
const latest = await articlePreview.findOne(
  { status: 'published' },
  { sort: { publishedAt: -1 } },
)
```

Both methods accept the relevant native driver options, including `session`.
Set the projection in `defineView`, rather than passing `projection` to a query.
Options that change the result shape, such as `raw`, `explain`, and `returnKey`,
are excluded from the view API.

## Find documents in ID order

`findByIds(ids, options?)` preserves input order, duplicates, and missing positions:

```ts
const firstId = new ObjectId('66d8f6d44d0f85c66a813df0')
const secondId = new ObjectId('66d8f70a4d0f85c66a813df1')
const missingId = new ObjectId('66d8f7684d0f85c66a813df2')

const ordered = await articlePreview.findByIds([
  secondId, missingId, firstId, secondId,
])
// If missingId has no match: [secondArticle, null, firstArticle, secondArticle]
```

An empty input returns `[]`. This method uses binary ID matching and does not
accept `sort`, `skip`, `limit`, or `collation`. Excluding `_id` from the result is
supported; projecting only part of a composite `_id` is not.

## Use a session

For `find`, `findOne`, and `findByIds`, a supplied `session` is passed to the root
query and every population query. Other query options apply only to the root.

```ts
const session = client.startSession()
try {
  const result = await articlePreview.find(
    { status: 'published' },
    { session, limit: 10 },
  )
  console.log(result.length)
} finally {
  await session.endSession()
}
```

Use the same client for collections participating in a session. If you need a
transaction, manage it with the driver's transaction API.

## Customize a read

`read(loader, options?)` supplies the resolved collection and the view's effective
projection. Apply that projection in your loader and return documents, a document,
or a nullish value. Materialize cursors before returning them.

```ts
const customPage = await articlePreview.read((collection, { projection }) =>
  collection.find({ status: 'published' }, { projection, limit: 10 }).toArray(),
)
```

The view populates the returned documents in place. Return documents whose
ownership you can transfer to the view. For a custom read with a session, pass
`session` to your loader's driver call and
`{ populateOptions: { session } }` as the second argument to `read`.

## Resolve collections lazily

The `collection` setting also accepts a function returning a collection or a
promise of one. `lazyDatabase` creates these providers from a database factory:

```ts
import { lazyDatabase } from 'mongodb-extras'

const collections = lazyDatabase(async () => {
  await client.connect()
  return { users: client.db('example').collection<User>('users') }
})

const lazyUserPreview = defineView({
  collection: collections.users,
  select: { name: 1 },
})
```

Providers resolve when a read needs them and are cached within that read. Your
application remains responsible for the client's lifetime.

Continue with [population](/mongodb-extras/population/) to compose views
across referenced collections.
