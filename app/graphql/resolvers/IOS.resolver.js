const { PrismaClient, Prisma } = require('@prisma/client')
const prisma = new PrismaClient()
const jwt = require('jsonwebtoken')
const { GraphQLError, graphql } = require('graphql')
const config = process.env
var decoded
function Auth () {
  decoded = jwt.verify(token, config.TOKEN_KEY)
  console.log(decoded, 'details')
  console.log(decoded.id, 'getid')
}
const IOSResolvers = {
  Query: {
    //-----------------------------------FOR IOS(------------------------------------------------------------//
    //for get all IOS (admin )
    getAllIOS: async (root, input) => {
      try {
        token = input['input']['token']
        Search = input['input']['Search']
        Auth()
        if (decoded.id && decoded.User_Type == 'admin') {
          const forFindIOS = await prisma.IOS.findMany({
            select: {
              id: true,
              Name: true,
              Type: true,
              createdAt: true,
              userId: true,
              Size: true
            }
          })
          console.log(forFindIOS)
          if (Search) {
            const searchToFind = await prisma.IOS.findMany({
              where: {
                Name: {
                  contains: Search,
                  mode: 'insensitive'
                }
              }
            })
            console.log(searchToFind)
            return searchToFind
          }
          console.log(forFindIOS)
          return forFindIOS
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Please enter valid credentials', {
          extensions: {
            StatusCode: 401,
            code: 'Failed '
          }
        })
      }
    },
    //FOR GET IOS BY ID (users)
    getIOSById: async (parent, input) => {
      try {
        token = input['input']['token']
        search = input['input']['search']
        Auth()
        if (decoded.id) {
          const getIOS = await prisma.IOS.findMany({
            where: {
              userId: decoded.id
            },
            select: {
              id: true,
              userId: true,
              Name: true,
              Type: true,
              createdAt: true,
              Size: true
            }
          })
          if (search) {
            const forFind = await prisma.iOS.findMany({
              where: {
                userId: decoded.id,
                Name: {
                  contains: search,
                  mode: 'insensitive'
                }
              }
            })
            console.log(forFind)
            return forFind
          }

          console.log(getIOS)
          return getIOS
        } else {
          throw new Error('Login again')
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Please enter valid credentials', {
          extensions: {
            StatusCode: 401,
            code: 'Failed '
          }
        })
      }
    }
  },
  Mutation: {
    //-------------------------------------------------IOS----------------------------------------------------//
    // fOR Create-IOS
    async createIOS (root, input) {
      try {
        token = input["input"]["token"]
        Auth();
        if (decoded.id) {
          const forCreateIOS = await prisma.IOS.create({
            data: {
              Name: input['input']['Name'],
              Type: input['input']['Type'],
              userId: decoded.id,
              createdAt: input['input']['createdAt'],
              Size: input['input']['Size'],
            }
          })
           console.log(forCreateIOS);
        return forCreateIOS
        }
     
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

    //FOR DELETE-IOS
    async deleteIOS (root, input) {
      try {
        token = input['input']['token']
        Auth()
        if (decoded.id && decoded.User_Type == 'admin') {
          const forDeleteIOS = await prisma.IOS.delete({
            where: {
              id: input['input']['id']
            }
          })
          console.log(forDeleteIOS)
          return 'IOS Deleted'
        }
        console.log(decoded.id)
        if (decoded.id && decoded.User_Type == 'user') {
          const forFind = await prisma.IOS.findUnique({
            where: {
              id: input['input']['id']
            }
          })
          console.log(forFind.userId, 'abc')
          console.log(forFind.id, 'id')
          if (decoded.id == for_find.userId) {
            const userDeleteIOS = await prisma.IOS.delete({
              where: {
                id: forFind.id
              }
            })
            console.log(userDeleteIOS)
            return 'deleted IOS'
          } else {
            throw new GraphQLError('', {
              extensions: {
                StatusCode: 333
              }
            })
          }
        }
      } catch (error) {
        console.log(error['extensions']['StatusCode'])
        console.log(error)
        if (error['extensions']['StatusCode'] == 333) {
          throw new GraphQLError('please enter valid credentials', {
            extensions: {
              StatusCode: 401,
              code: 'Invalid Credentials'
            }
          })
        } else {
          console.log('hello')
          throw new GraphQLError('Failed to Delete', {
            extensions: {
              StatusCode: 400,
              code: 'Failed'
            }
          })
        }
      }
    }
  }
}
module.exports = IOSResolvers
