import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import logger from '@main/logger';

const prisma = new PrismaClient();

const allNotification = {
  Query: {
    getNotification: async () => {
      try {
        const forGetNotification = await prisma.notification.findMany({});
        return forGetNotification;
      } catch (error: any) {
        logger.error(error.toString(), error.message);
        throw new GraphQLError('failed to get all notifications ', {
          extensions: {
            StatusCode: 500,
            code: 'Failed ',
          },
        });
      }
    },
  },
};

export default allNotification;
