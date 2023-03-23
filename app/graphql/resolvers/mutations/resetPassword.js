import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()
const bcryptRounds = parseInt(process.env.Constant)

const forResetPassword = {
  Mutation: {
    async resetPassword (_root, input) {
      const config = process.env
      try {
        const token = input.input.token
        const decoded = jwt.verify(token, config.TOKEN_KEY)
        const password = input.input.password
        const encryptedPassword = await bcrypt.hash(password, bcryptRounds)
        await prisma.user
          .update({
            where: {
              id: decoded.id
            },
            data: {
              password: encryptedPassword
            }
          })
        return 'Password Reset'
      } catch (error) {
        logger.log(error)
        throw new GraphQLError('Something went wrong please try again', {
          extensions: {
            StatusCode: 404
          }
        })
      }
    }
  }
}
export default forResetPassword
