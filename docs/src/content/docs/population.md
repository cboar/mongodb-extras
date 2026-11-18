---
title: Populate MongoDB references without an ORM
description: Populate typed MongoDB references with reusable views, nested paths, custom foreign keys, filters, and explicit missing-reference policies.
---

Population replaces stored reference values with documents from another view.
The examples build on the `users`, `articles`, and `userPreview` definitions in
[getting started](/mongodb-extras/).

## Populate a field or reference array

```ts
const populatedArticles = defineView({
  collection: articles,
  select: { title: 1 },
  populate: {
    authorId: userPreview,
    reviewerIds: userPreview,
  },
})

const article = await populatedArticles.findOne({ status: 'published' })
console.log(article?.authorId?.name)
console.log(article?.reviewerIds.map((reviewer) => reviewer?.name))
```

References match the target's `_id` by default. The target view controls the
populated document's fields, so `userPreview` returns `_id` and `name`.

Populated paths are added to inclusion projections automatically. Explicitly
excluding a reference path prevents it from being fetched and populated. To keep
other fields in an embedded document, include its parent in `select`.

Population uses additional batched queries to target collections. A root filter
matches stored reference values, not fields on the resulting populated documents.

## Traverse embedded documents and arrays

Use dot notation for a reference inside an embedded document or array element:

```ts
interface Conference {
  _id: ObjectId
  name: string
  sessions: Array<{ title: string; speakerId: ObjectId }>
}

const conferences = db.collection<Conference>('conferences')
const conferenceView = defineView({
  collection: conferences,
  select: { name: 1, sessions: 1 },
  populate: { 'sessions.speakerId': userPreview },
})

const conference = await conferenceView.findOne()
console.log(conference?.sessions[0]?.speakerId?.name)
```

Here, selecting `sessions` keeps each session's `title` as well as its populated
speaker. To populate relations of a referenced document, give its target view its
own `populate` configuration. Keep view definitions acyclic.

## Share a view configuration

When two views differ by a few fields, define one as a constant and spread it
into the other. `as const` keeps the selection literal for inference.

```ts
const articleDetailConfig = {
  collection: articles,
  select: { reviewerIds: 0 },
  populate: { authorId: userPreview },
} as const

const articleDetail = defineView(articleDetailConfig)
const articleSummary = defineView({
  ...articleDetailConfig,
  select: { ...articleDetailConfig.select, body: 0 },
})
```

`articleSummary` omits `body`, and `articleDetail` keeps it. Treat the shared
object as read-only after passing it to `defineView`.

## Match a different foreign key

Use `foreignKey` when the stored value points to a field other than `_id`:

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

const book = await bookView.findOne({ publisherCode: 'northwind' })
console.log(book?.publisherCode?.name)
```

The target selection must retain the matching key (`code` here). A view that
excludes it is rejected when the relation is defined. Index custom foreign keys;
use a unique index when each reference should identify one document. If several
documents match a key, population uses the first returned match.

## Filter target documents

Wrap a reusable view with `view` to add relation-specific options:

```ts
const reviewedArticles = defineView({
  collection: articles,
  select: { title: 1 },
  populate: {
    reviewerIds: {
      view: userPreview,
      filter: { name: { $ne: 'Hidden' } },
      onUnresolved: 'filter',
    },
  },
})
```

`filter` applies to the target collection's source schema, including fields
omitted by its selection. Targets rejected by the filter are unresolved
references; the root article remains in the result.

## Choose how unresolved references behave

Set `onUnresolved` on each relation:

| Policy | Behavior |
| --- | --- |
| `'null'` (default) | Replace unmatched references with `null`; keep array positions and duplicates. |
| `'filter'` | Remove unmatched and existing nullish array entries; an unmatched scalar becomes `null`. |
| `'throw'` | Reject the read with `PopulateUnresolvedError` for an unresolved non-nullish reference. |

Existing `null`, `undefined`, and absent scalar fields are left as they are.
The default and `'throw'` policies also preserve existing nullish array entries.

For a required reference, where `D` is the target view's document type:

| Policy | `ObjectId` | `ObjectId[]` |
| --- | --- | --- |
| `'null'` (default) | `D \| null` | `(D \| null)[]` |
| `'filter'` | `D \| null` | `D[]` |
| `'throw'` | `D` | `D[]` |

```ts
import { PopulateUnresolvedError } from 'mongodb-extras'

const strictArticles = defineView({
  collection: articles,
  populate: { authorId: { view: userPreview, onUnresolved: 'throw' } },
})

try {
  await strictArticles.findOne({ status: 'published' })
} catch (error) {
  if (error instanceof PopulateUnresolvedError) {
    console.error(error.path, error.foreignKey, error.reason, error.index)
  }
  throw error
}
```

The error has code `POPULATE_UNRESOLVED`. Its `reason` is `'not-found'` when no
target matches or `'unkeyable'` when the reference cannot form a lookup key.
`index` identifies the original position for an array reference.

All view read methods apply these policies. Driver and database errors propagate
normally. See [projections and queries](/mongodb-extras/projections/) for
query options, custom reads, and session propagation.
