import file from '../../../configFile/config.js'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
const forConfigFile = {
  Query: {
    getConfigFile: async () => {
      try {
        const configFile = file
        return configFile
      } catch (error) {
        logger.error(error, error.message)
        throw new GraphQLError('Sign-up Failed', {
          extensions: {
            StatusCode: 400,
            code: 'Sign-up Failed'
          }
        })
      }
    }
  }
}
export default forConfigFile
