import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

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
