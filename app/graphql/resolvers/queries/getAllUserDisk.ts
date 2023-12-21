import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import logger from '@main/logger';

const prisma = new PrismaClient();

const getAllUserDisk = {
  Query: {
    getDiskDetails: async (root: any, input: any) => {
      try {
        const forGetList = await prisma.disk.findMany({
          select: {
            id: true,
            diskName: true,
            diskSize: true,
          },
        });
        return forGetList;
      } catch (error: any) {
        logger.error(error, error.message);
        throw new GraphQLError('Failed to get Details ', {
          extensions: {
            StatusCode: 400,
          },
        });
      }
    },
  },
};

export default getAllUserDisk;