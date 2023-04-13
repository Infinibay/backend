import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()
const RandomStringLength = parseInt(process.env.RANDOMSTRINGLENGTH)

const forUpdateUser = {
  Mutation: {
    async updateUser (_root, input) {
      try {
        const token = input.input.token
        const forID = AuthForBoth(token).id
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
        if (forID) {
          if (userImage) {
            const forUpdateUser = await prisma.user.update({
              where: {
                id: forID
              },
              data: {
                firstName: input.input.firstName,
                lastName: input.input.lastName,
                eMail: input.input.eMail,
                password: input.input.password,
                deleted: input.input.deleted,
                userImage: path
              }
            })
            return forUpdateUser
          }
          if (userImage === null || !userImage) {
            const forUpdateUserWithoutImage = await prisma.user.update({
              where: {
                id: forID
              },
              data: {
                firstName: input.input.firstName,
                lastName: input.input.lastName,
                eMail: input.input.eMail,
                password: input.input.password,
                deleted: input.input.deleted
              }
            })
            return forUpdateUserWithoutImage
          }
        }
      } catch (error) {
        logger.error(error, error.message)
        throw new GraphQLError('Update Failed..!', {
          extensions: {
            StatusCode: 404
          }
        })
      }
    }
  }
}
export default forUpdateUser
