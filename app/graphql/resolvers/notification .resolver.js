const { PrismaClient, Prisma } = require('@prisma/client')
const prisma = new PrismaClient()
const jwt = require('jsonwebtoken')
const { GraphQLError } = require('graphql')
const config = process.env
var decoded
function Auth () {
  decoded = jwt.verify(token, config.TOKEN_KEY)
  console.log(decoded, 'details')
  console.log(decoded.id, 'getid')
}
const notificationResolver = {
  Query: {
    ////------------------------------------FOR NOTIFICATION------------------------------------------------------////
    // GET  notification
    getNotification: async () => {
      try {
        const forGetNotification = await prisma.notification.findMany({})
        return forGetNotification
      } catch (error) {
        throw new GraphQLError('failed to get all notifications ', {
          extensions: {
            StatusCode: 500,
            code: 'Failed '
          }
        })
      }
    },
    getUserNotification: async (root, input) => {
      try {
        token = input['input']['token']
        Auth()
        if (decoded.id) {
          const userNotification = await prisma.notification.findMany({
            where: {
              userId: decoded.id
            }
          })
          console.log(userNotification)
          return userNotification
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Please enter valid credentials ', {
          extensions: {
            StatusCode: 401,
            code: 'Failed '
          }
        })
      }
    }
  },

  Mutation: {
    //----------------------------------------------- NOTIFICATION-----------------------------------------------------//
    // FOR ADD NOTIFICATION
    async addNotification (root, input) {
      try {
        const forNotification = await prisma.notification.create({
          data: {
            Message: input['input']['Message'],
            userId: input['input']['userId'],
            vm_id: input['input']['vmId'],
            Readed: input['input']['Readed']
          }
        })
        console.log(forNotification)
        return forNotification
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Failed to Create', {
          extensions: {
            StatusCode: 400,
            code: 'Failed '
          }
        })
      }
    },
    //FOR UPDATE NOTIFICATION
    async updateNotification (root, input) {
      try {
        const forNotificationUpdate = await prisma.notification.updateMany({
          where: {
            userId: input['input']['userId']
          },
          data: {
            Readed: input['input']['Readed']
          }
        })
        console.log(forNotificationUpdate)
        return 'Updated'
      } catch (error) {
        throw new GraphQLError('Failed to Update', {
          extensions: {
            StatusCode: 400,
            code: 'Failed '
          }
        })
      }
    },
    //FOR DELETE NOTIFICATION
    async deleteNotification (root, input) {
      try {
        const forDeleteNotification = await prisma.notification.delete({
          where: {
            id: input['input']['id']
          }
        })
        console.log(forDeleteNotification)
        return 'Deleted'
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Failed to Delete', {
          extensions: {
            StatusCode: 404,
            code: 'Failed '
          }
        })
      }
    }
  }
}

module.exports = notificationResolver
