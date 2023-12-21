import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import logger from '@main/logger';

const prisma = new PrismaClient();

interface FindVMNameInput {
  input: {
    virtualMachineName: string;
  };
}

const forVirtualMachineName = {
  Query: {
    findVMName: async (root: any, input: FindVMNameInput) => {
      try {
        const forFindVMName = await prisma.virtualMachine.findUnique({
          where: {
            virtualMachineName: input.input.virtualMachineName
          },
          select: {
            virtualMachineName: true
          }
        });
        if (forFindVMName) {
          return 'true';
        } else {
          return 'false';
        }
      } catch (error: any) {
        logger.error(error, error.message);
        throw new GraphQLError('Error finding virtual machine name', {
          extensions: {
            code: 'VIRTUAL_MACHINE_ERROR'
          }
        });
      }
    }
  }
};

export default forVirtualMachineName;
