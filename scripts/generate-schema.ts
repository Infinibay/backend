import 'reflect-metadata'
import { buildSchema } from 'type-graphql'
import path from 'path'
import resolvers from '@graphql/resolvers'
import { authChecker } from '@utils/authChecker'

async function generateSchema() {
  try {
    console.log('Generating GraphQL schema...')

    const schema = await buildSchema({
      resolvers,
      emitSchemaFile: path.join(process.cwd(), 'app', 'schema.graphql'),
      authChecker,
      validate: false
    })

    console.log('✅ Schema generated successfully at app/schema.graphql')
    process.exit(0)
  } catch (error) {
    console.error('❌ Error generating schema:', error)
    process.exit(1)
  }
}

generateSchema()
