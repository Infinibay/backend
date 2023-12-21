import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { GraphQLError } from 'graphql'
import ms from 'ms'
import logger from '@main/logger'

const prisma = new PrismaClient()
const forExpiresIn = ms(process.env.EXPIRESIN ?? '1d')

const login = {
  Mutation: {
    async Login(root: any, input: any) {
      try {
        const eMail = input.input.eMail
        const password = input.input.password
        const forLogin: any = await prisma.user.findUnique({
          where: {
            eMail
          }
        })
        if (!(password || eMail)) {
          throw new Error('All input is required')
        }
        if ((await bcrypt.compare(password, forLogin.password)) === true) {
          const forUpdateToken = await prisma.user.update({
            where: {
              id: forLogin.id
            },
            data: {
              token: jwt.sign(
                {
                  id: forLogin.id,
                  eMail: forLogin.eMail,
                  userType: forLogin.userType
                },
                process.env.TOKENKEY ?? '',
                {
                  expiresIn: forExpiresIn
                }
              )
            }
          })
          return forUpdateToken
        } else {
          throw new GraphQLError('Wrong password..!', {
            extensions: {
              StatusCode: 401
            }
          })
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Login Failed ' + 'Please Try Again....!', {
          extensions: {
            StatusCode: 401
          }
        })
      }
    }
  }
}
export default login;
