import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { UserQueries } from './queries';
import { UserMutations } from './mutations';
import { InfinibayContext } from '../../../utils/context';

const prisma = new PrismaClient();

// Clear the data from users before each test
beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe('UserResolvers', () => {
  let queries: UserQueries;
  let mutations: UserMutations;
  let context: InfinibayContext;

  beforeEach(() => {
    queries = new UserQueries();
    mutations = new UserMutations();
    context = { prisma } as InfinibayContext;
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  describe('queries', () => {
    it('should return all users', async () => {
      // Create some test users
      await prisma.user.createMany({
        data: [
          { email: 'user1@test.com', password: 'password', firstName: 'User', lastName: 'One', role: 'USER', deleted: false },
          { email: 'user2@test.com', password: 'password', firstName: 'User', lastName: 'Two', role: 'USER', deleted: false },
        ],
      });

      const result = await queries.users({}, { take: 10, skip: 0 });

      expect(result).toHaveLength(2);
      expect(result.map(u => u.email)).toEqual(['user1@test.com', 'user2@test.com']);
    });
  });

  describe('mutations', () => {
    it('should create a new user', async () => {
      const input = {
        email: 'newuser@test.com',
        password: 'password',
        passwordConfirmation: 'password',
        firstName: 'New',
        lastName: 'User',
        role: 'USER'
      };

      const result = await mutations.createUser(input);

      expect(result).toHaveProperty('id');
      expect(result.email).toBe('newuser@test.com');
    });
  });
});
