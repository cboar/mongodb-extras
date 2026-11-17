import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

const socialImage = 'https://cboar.github.io/mongodb-extras/social-preview.png'
const socialImageAlt =
  'mongodb-extras: TypeScript projections and populated references for the native MongoDB driver. No ORM.'

export default defineConfig({
  site: 'https://cboar.github.io',
  base: '/mongodb-extras',
  trailingSlash: 'always',
  vite: {
    tsconfig: './tsconfig.json',
  },
  integrations: [
    starlight({
      title: 'mongodb-extras',
      description:
        'TypeScript projection inference and reference population for the native MongoDB Node.js driver.',
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: socialImage } },
        { tag: 'meta', attrs: { property: 'og:image:type', content: 'image/png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: socialImageAlt } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: socialImage } },
        { tag: 'meta', attrs: { name: 'twitter:image:alt', content: socialImageAlt } },
        { tag: 'meta', attrs: { name: 'robots', content: 'max-image-preview:large' } },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/cboar/mongodb-extras' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/mongodb-extras' },
      ],
      editLink: {
        baseUrl: 'https://github.com/cboar/mongodb-extras/edit/main/docs/',
      },
      sidebar: [
        { label: 'Getting started', slug: 'index' },
        { label: 'Projections & queries', slug: 'projections' },
        { label: 'Population', slug: 'population' },
      ],
    }),
  ],
})
