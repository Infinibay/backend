import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { GraphQLError } from 'graphql'
import fs from 'fs'
import logger from '@main/logger'

const prisma = new PrismaClient()
const bcryptRounds = parseInt(process.env.CONSTANT || '0')
const RandomStringLength = parseInt(process.env.RANDOMSTRINGLENGTH || '0')

const signUp = {
  Mutation: {
    async createUser(root: any, input: any) {
      try {
        const path =
          'app/userImage/' +
          (Math.random() + 1).toString(36).substring(RandomStringLength) +
          '.jpeg'
        const userImage = input.input.userImage
        if (userImage) {
          const base64Data = await userImage.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ''
          )
          fs.writeFileSync(path, base64Data, { encoding: 'base64' })
        }
        const encryptedPassword = await bcrypt.hash(
          input.input.password,
          bcryptRounds
        )

        const userCreate = await prisma.user.create({
          data: {
            firstName: input.input.firstName,
            lastName: input.input.lastName,
            eMail: input.input.eMail,
            password: encryptedPassword,
            deleted: input.input.deleted,
            userImage: path,
            userType: input.input.userType
          }
        })
        return userCreate
      } catch (error: any) {
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
export default signUp
