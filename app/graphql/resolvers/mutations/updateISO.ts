import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import isAuthForUser from '@services/isAuthForUser'

const prisma = new PrismaClient()

const forUpdateISO = {
  Mutation: {
    async updateISO(root: any, input: any) {
      try {
        const token = input.input.token
        const forID = isAuthForUser(token).id
        if (forID) {
          const id = input.input.id
          const forUpdatingISO: any = await prisma.iSO.findUnique({
            where: {
              id
            },
            select: {
              id: true,
              type: true,
              name: true,
              userId: true,
              size: true,
              createdAt: true
            }
          })

          if (forUpdatingISO.userId === forID) {
            const forUpdate = await prisma.iSO.update({
              where: {
                id: input.input.id
              },
              data: {
                type: input.input.type
              },
              select: {
                id: true,
                type: true,
                name: true,
                size: true,
                userId: true,
                createdAt: true
              }
            })
            console.log('forUpdate')
            return forUpdate
          }
        }
      } catch (error: any) {
        throw new GraphQLError('Failed to Update', {
          extensions: {
            StatusCode: 404,
            code: 'Failed '
          }
        })
      }
    }
  }
}
export default forUpdateISO
