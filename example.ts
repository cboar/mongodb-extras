// Local repository example. In installed consumers, import from 'mongodb-extras':
// import { defineView } from 'mongodb-extras'
import { defineView } from './src/index.ts'
import { closeClient, seedDatabase } from './test/shared.ts'

// Seed the live MongoDB database with initial fixtures
const { partners, courses } = await seedDatabase()

const partnerSummary = defineView({
  collection: partners,
  select: { name: 1, parentName: 1 },
})

// Match parent partner by custom foreign key 'name'
const partnerDetail = defineView({
  collection: partners,
  select: { name: 1, parentName: 1 },
  populate: {
    parentName: { view: partnerSummary, foreignKey: 'name' },
  },
})

const courseView = defineView({
  collection: courses,
  select: { title: 1, partner: 1, published: 1 },
  populate: {
    partner: partnerDetail,
  },
})

console.log('--- Executing courseView.find() ---')
const allCourses = await courseView.find({ published: true }, { sort: { title: 1 }, limit: 30 })

console.log('\n--- Populated Result ---')
console.log(JSON.stringify(allCourses, null, 2))

console.log('\n--- Executed DB Queries ---')
console.log('Partners Collection Queries:', partners.queries)

// Single document read
const courseById = await courseView.findOne({ _id: 1 })

console.log('\n--- Single Course Result ---')
console.log(JSON.stringify(courseById, null, 2))

await closeClient()
