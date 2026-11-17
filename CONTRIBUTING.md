# Contributing

The docs are an Astro + Starlight project in `docs/`, with their own npm package
and lockfile. Public pages live in `docs/src/content/docs/`. Internal development
notes live in the ignored `dev/` directory.

## Build locally

Use Node.js 24 (the docs require Node.js 22.23.4 or newer). From the repository root:

```sh
npm ci --prefix docs
npm run docs:dev
```

Open `http://localhost:4321/mongodb-extras/`. Changes to Markdown pages refresh
automatically. To build and preview the production site, including search:

```sh
npm run docs:build
npm run docs:preview
```

Output goes to `docs/dist/`. Search is indexed during the production build and is
available in the production preview. The library's Node.js requirement remains
unchanged; docs dependencies are separate from the library.

## Edit or add a page

Add a Markdown file under `docs/src/content/docs/`. Include a title and unique
description in YAML front matter:

```markdown
---
title: My guide
description: What this guide helps readers do.
---

Start with a short introduction.

## First step

Add explanations and fenced code examples here.
```

Starlight generates the page's main heading from `title`, so start body headings
at `##`. A file named `my-guide.md` becomes `/mongodb-extras/my-guide/`; `index.md`
is the homepage. Add sidebar entries in `docs/astro.config.mjs`.

Use standard Markdown links with the repository prefix:

```markdown
[Population](/mongodb-extras/population/)
```

Before submitting, build the site and check links, page titles, canonical URLs,
and `docs/dist/sitemap-0.xml`. Check TypeScript examples against the public API.
Astro validates page front matter during the build. Starlight supplies the shared
layout, navigation, table of contents, search, syntax highlighting, and SEO tags.

## Releases

When a change is ready for npm, bump the root package version in its PR:

```sh
npm version patch --no-git-tag-version
```

Choose `minor`, `major`, or an explicit version as appropriate. Commit both
`package.json` and `package-lock.json`.

After merging into `main`, the Release workflow runs CI, tags the verified commit
as `v<version>`, publishes to npm, and creates a GitHub Release with generated
notes. An already-tagged version on an earlier commit is skipped, so ordinary
changes can merge without publishing. Stable versions use npm's `latest` tag;
prereleases use `next` and are marked as prereleases on GitHub.

For transient failures, rerun the original workflow run. It reuses the existing
tag and skips npm publication if that version already exists. If a fix requires
source changes after tagging, bump the version again. npm rejects older stable
versions that would replace a newer release as `latest`; avoid retrying older
prereleases after a newer one has taken the `next` tag.

Manual workflow runs are also supported on `main`. Publishing uses the existing
npm trusted publisher configuration, with `NPM_TOKEN` available as a fallback.
