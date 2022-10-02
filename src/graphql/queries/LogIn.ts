import bcrypt from 'bcrypt';
import {
  UserInputError
} from 'apollo-server-express';

import { PASSWORD_PASSES } from '../../utils/globals';
import { generateToken } from '../../utils/functions';
import { PrismaClient } from '@prisma/client';

export async function LogIn(parent: any, args: any, context: any, info: any): Promise<any> {
  const hashedPassword = bcrypt.hashSync(args.password, PASSWORD_PASSES)
  const prisma = new PrismaClient()
  console.log("hashedPassword", args, hashedPassword)
  // console.log("kkkkkkkkkkkkkkkkkkkkkkkkkkkk", context)
  // TODO: This is an exmample, it should not be like this
  // password should be hashed and compared with the hash
  const user = await prisma.user.findFirst({
    where: {
      email: args.email
    }
  });
  // Generate a jwt token
  // const token = jwt.sign({ userId: user.id }, APP_SECRET)
  console.log("---------- user", user)
  if (!user) {
    return {
      errors: {
        message: 'Invalid credentials'
      }
    }
  } else if (!bcrypt.compare(args.password, user.password)) {
    return {
      errors: {
        message: 'Invalid credentials'
      }
    }
  }

  const token = generateToken({userId: user?.id}, {});

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    },
  }
}