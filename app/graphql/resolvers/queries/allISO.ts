import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import logger from '@main/logger';
import isAuth from '@services/isAuth';

const prisma = new PrismaClient();

const forAllSO = {
  Query: {
    getAllISO: async (_root: any, input: any) => {
      try {
        const token = input.input.token;
        const search = input.input.search;
        const forAuth = isAuth(token).id;
        if (forAuth) {
          const forFindISO = await prisma.iSO.findMany({
            select: {
              id: true,
              name: true,
              type: true,
              userId: true,
              size: true,
            },
          });
          if (search) {
            const searchToFind = await prisma.iSO.findMany({
              where: {
                name: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            });
            return searchToFind;
          }
          return forFindISO;
        }
      } catch (error: any) {
        logger.error(error, error.message);
        throw new GraphQLError('Please enter valid credentials', {
          extensions: {
            StatusCode: 400,
          },
        });
      }
    },
  },
};

export default forAllSO;
