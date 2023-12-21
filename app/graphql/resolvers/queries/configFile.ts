import file from '../../../configFile/config.js';
import { GraphQLError } from 'graphql';
import logger from '@main/logger';

const forConfigFile: any = {
  Query: {
    getConfigFile: async () => {
      try {
        const configFile: any = file;
        return configFile;
      } catch (error: any) {
        logger.error(error, error.message);
        throw new GraphQLError('Sign-up Failed', {
          extensions: {
            StatusCode: 400,
            code: 'Sign-up Failed'
          }
        });
      }
    }
  }
};

export default forConfigFile;
