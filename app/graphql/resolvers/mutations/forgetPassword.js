import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import smtpTransport from 'nodemailer-smtp-transport'
import nodemailer from 'nodemailer'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import ms from 'ms'
import fs from 'fs'
import ejs from 'ejs'
const prisma = new PrismaClient()
const forgetPasswordExpiredIn = ms(process.env.forgetPasswordExpiredIn)

const forgetPassword = {
  Mutation: {
    async forgetPassword (root, input) {
      try {
        const userEmail = await prisma.user.findUnique({
          where: {
            eMail: input.input.eMail
          }
        })
        if (userEmail) {
          if (!userEmail) {
            throw new Error('please verify your email')
          }
          if (userEmail.deleted === false) {
            const tokenss = jwt.sign(
              {
                id: userEmail.id,
                eMail: userEmail.eMail
              },
              process.env.TOKEN_KEY,
              {
                expiresIn: forgetPasswordExpiredIn
              }
            )
            const token = tokenss
            const transporter = nodemailer.createTransport(
              smtpTransport({
                service: 'gmail',
                host: 'smtp.gmail.com',
                auth: {
                  user: process.env.user,
                  pass: process.env.pass
                }
              })
            )
            const template = fs.readFileSync(
              'app/graphql/resolvers/mutations/forgetPassword.ejs',
              'utf-8'
            )
            const data = {
              token
            }
            const html = ejs.render(template, data)
            const mailOptions = {
              from: process.env.user,
              to: userEmail.eMail,
              subject: 'Password Reset',
              text: 'That was easy!',
              html
            }
            transporter.sendMail(mailOptions, function (error, info) {
              if (error) {
                return error
              } else {
                return 'Email sent: ' + info.response
              }
            })
            return 'Check Your Mail'
          }
          if (userEmail.deleted === true) {
            throw new Error('User Profile Not Found ')
          }
        } else {
          throw new Error('NOT FOUND')
        }
      } catch (error) {
        logger.error(error)
        throw new GraphQLError('Something went wrong please try again', {
          extensions: {
            StatusCode: 404
          }
        })
      }
    }
  }
}
export default forgetPassword
