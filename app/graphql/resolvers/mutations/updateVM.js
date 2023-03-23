import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '../../../services/isAuthForBoth.js'
import fs from 'fs'
import axios from 'axios'
const prisma = new PrismaClient()
const RandomStringLength = parseInt(process.env.RandomStringLength)

const updateVMResolvers = {
  Mutation: {
    async upadteVM (_root, input) {
      try {
        const path =
          'app/VM_image/' +
          (Math.random() + 1).toString(36).substring(RandomStringLength) +
          '.jpeg'

        const vmImage = input.input.vmImage
        if (vmImage) {
          const base64Data = await vmImage.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ''
          )
          fs.writeFileSync(path, base64Data, { encoding: 'base64' })
          console.log(path)
        }

        const token = input.input.token

        const forID = AuthForBoth(token).id
        if (forID) {
          const id = input.input.id
          const forUpdatingVM = await prisma.virtualMachine.findUnique({
            where: {
              id
            },
            select: {
              id: true,
              virtualMachineName: true,
              user: {
                select: {
                  id: true,
                  eMail: true
                }
              }
            }
          })
          console.log(forUpdatingVM.virtualMachineName)
          const virtualMachineName = input.input.virtualMachineName
          const confii = JSON.parse(input.input.Config)
          // let size = confii["getConfigFile"]["Memory"];
          const count = confii.getConfigFile.processor.Processors

          if (forUpdatingVM.user.id === forID) {
            //  var data1 = JSON.stringify({
            //   jsonrpc: "2.0",
            //   method: "updateAllCall",3

            //   params: {
            //     name: forUpdatingVM.virtualMachineName,
            //     newname : virtualMachineName,
            //     // cpu : cpu ,
            //     // ram: ram,
            //   },
            //   id: 1,
            // });
            // console.log(data1);
            // var data2 = JSON.stringify({
            //   jsonrpc: "2.0",
            //   method: "updateMemoryCall",
            //   params: {
            //     name: forUpdatingVM.virtualMachineName,
            //     size: size,
            //   },
            //   id: 1,

            // });
            // console.log(data2);
            //     updateAllCall(name,newname,cpu,ram)
            const data3 = JSON.stringify({
              jsonrpc: '2.0',
              method: 'updateCpuCall',
              params: {
                name: forUpdatingVM.virtualMachineName,
                count
              },
              id: 1
            })

            console.log(data3, 'kkkkkkkkk')
            const config = {
              method: 'post',
              maxBodyLength: Infinity,
              url: 'http://168.119.24.70:5001',
              headers: {
                'Content-Type': 'application/json'
              },
              data: data3
            }

            const kk = await axios(config)
            console.log(kk)
            console.log(kk.data.result, '//')

            console.log(kk.data.result, 'hhbehdhjbd')
            if (kk.data.result.status === true) {
              if (vmImage) {
                const forUpdate = await prisma.virtualMachine.update({
                  where: {
                    id: input.input.id
                  },
                  data: {
                    virtualMachineName,
                    title: input.input.title,
                    description: input.input.description,
                    status: input.input.status,
                    userId: input.input.userId,
                    config: input.input.config,
                    vmImage: path
                  },
                  select: {
                    id: true,
                    virtualMachineName: true,
                    description: true,
                    status: true,
                    config: true,
                    title: true,
                    vmImage: true
                  }
                })
                console.log('forUpdate')
                return forUpdate
              }

              if (vmImage === null || !vmImage) {
                const forUpdatewithoutimage =
                  await prisma.virtualMachine.update({
                    where: {
                      id: input.input.id
                    },
                    data: {
                      virtualMachineName: input.input.virtualMachineName,
                      title: input.input.title,
                      Description: input.input.description,
                      status: input.input.status,
                      userId: input.input.userId,
                      config: input.input.config
                    },
                    select: {
                      id: true,
                      virtualMachineName: true,
                      description: true,
                      status: true,
                      config: true,
                      title: true,
                      vmImage: true
                    }
                  })
                console.log('forUpdatewithoutimage')
                return forUpdatewithoutimage
              }
            }
          } else {
            throw new Error('Error')
          }
        }
      } catch (error) {
        console.log(error)
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
export default updateVMResolvers
