---
title: Typed MongoDB views in TypeScript
description: Get started with mongodb-extras to infer MongoDB projections and populate references using the native Node.js driver.
---

`mongodb-extras` adds projection inference and reference population to the native
MongoDB Node.js driver. Define a reusable view, then query it with your existing
filters, collections, and sessions.

A view describes a read shape in your application. It does not create a MongoDB
server-side view or change stored documents.

## Install

```sh
npm install mongodb-extras mongodb
```

The package is ESM-only, requires Node.js 20 or newer, and supports MongoDB driver
6 and 7. The examples use TypeScript in an ESM project with strict type checking.

## Define your collections

Start with the document types you already pass to the MongoDB driver:

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
```

## Select fields and populate references

Define a view for each reusable result shape. A populated field is replaced by
the matching document from its target view.

```ts
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

`_id` is retained by default. Populated paths are included automatically in an
inclusion projection, so you do not need to repeat them in `select`.

## Query the view

```ts
const recentArticles = await articlePreview.find(
  { status: 'published' },
  { sort: { publishedAt: -1 }, limit: 20 },
)

for (const article of recentArticles) {
  console.log(article.title)
  console.log(article.authorId?.name)
  console.log(article.reviewerIds.map((reviewer) => reviewer?.name))
}

await client.close()
```

TypeScript infers the selected fields and populated relations. Here, `body` and
`authorId.email` are absent from the result type. An unmatched reference becomes
`null`; reference arrays keep their order and duplicates.

`find` returns an array. Use `findOne` for a document or `null`, and `findByIds`
when results must follow an input list of IDs.

## Next steps

- [Projections and queries](/mongodb-extras/projections/): selection rules,
  inferred types, query options, ordered lookups, and custom reads.
- [Populate references](/mongodb-extras/population/): nested paths,
  foreign keys, relation filters, and missing-reference policies.

For writes and operations outside a view, keep using the native collection.
