import { PrismaClient } from '@prisma/client'
import forSpecificDiskDetail from '../app/graphql/resolvers/queries/getSpecificDiskDetails.js'
import forUserById from '../app/graphql/resolvers/queries/userById.js'
import ISOById from '../app/graphql/resolvers/queries/ISOById.js'
import specificVirtualMachine from '../app/graphql/resolvers/queries/specificVirtualMachine.js'

import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: '33bfd355-bcf0-4b91-8a41-8389f497862e' })
})
describe('forSpecificDiskDetail', () => {
  test('getSpecificDiskDetails', async () => {
    const mockInput = { input: { id: '1481fdae-5f85-46ee-a664-567dea5d98dd' } }
    jest.spyOn(prisma.disk, 'findUnique').mockReturnValueOnce({ id: '1481fdae-5f85-46ee-a664-567dea5d98dd' })
    const result = await forSpecificDiskDetail.Query.getSpecificDiskDetails(null, mockInput)
    expect(result).toEqual(
      {
        id: '1481fdae-5f85-46ee-a664-567dea5d98dd',
        diskSize: 2,
        diskName: 'kkkk'
      }
    )
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.disk, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await forSpecificDiskDetail.Query.getSpecificDiskDetails(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })

  /// //////////  get user by id //////////////////////
  test('getUserByID', async () => {
    const mockInput = { input: { id: '33bfd355-bcf0-4b91-8a41-8389f497862e' } }
    jest.spyOn(prisma.user, 'findUnique').mockReturnValueOnce({ id: '33bfd355-bcf0-4b91-8a41-8389f497862e' })
    const result = await forUserById.Query.getUserByID(null, mockInput)
    expect(result).toEqual({
      _count: {
        ISO: 2,
        storage: 3,
        notification: 0,
        VM: 1
      },
      deleted: false,
      eMail: 'fizzafatima642@gmail.com',
      firstName: 'syeda',
      lastName: 'fiza',
      id: '33bfd355-bcf0-4b91-8a41-8389f497862e',
      userImage: 'app/userImage/sn.jpeg',
      userType: 'user'
    })
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await forUserById.Query.getUserByID(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
  /// //////////  get ISO by id //////////////////////

  test('getISOById', async () => {
    const mockInput = { input: { userId: '33bfd355-bcf0-4b91-8a41-8389f497862e' } }
    jest.spyOn(prisma.ISO, 'findMany').mockReturnValueOnce({ userId: '33bfd355-bcf0-4b91-8a41-8389f497862e' })
    const result = await ISOById.Query.getISOById(null, mockInput)
    expect(result).toEqual([
      {
        type: 'window',
        size: 2,
        name: 'newww.iso',
        id: '0cc915c2-20d8-4862-b0a9-3cf970db92a1',
        userId: '33bfd355-bcf0-4b91-8a41-8389f497862e'

      },
      {
        type: 'window',
        size: 2,
        name: 'neewww.iso',
        id: '95fb80ef-6788-4d83-aa85-90ace4a257d7',
        userId: '33bfd355-bcf0-4b91-8a41-8389f497862e'

      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.ISO, 'findMany').mockRejectedValue(new Error('mockError'))
    try {
      await ISOById.Query.getISOById(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })

  test('getSpecificVM', async () => {
    const mockInput = { input: { id: '90c482f2-9ff8-4e14-96a4-8daf70dd9a22' } }
    jest.spyOn(prisma.virtualMachine, 'findUnique').mockReturnValueOnce({ id: '90c482f2-9ff8-4e14-96a4-8daf70dd9a22' })
    const result = await specificVirtualMachine.Query.getSpecificVM(null, mockInput)
    expect(result).toEqual({
      user: {
        eMail: 'fizzafatima642@gmail.com',
        id: '33bfd355-bcf0-4b91-8a41-8389f497862e'
      },
      userId: '33bfd355-bcf0-4b91-8a41-8389f497862e',
      config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
      description: 'virtualmachine89',
      guId: '130fd53d-f0a1-49e1-aaff-bc7b756f4d52',
      status: true,
      id: '90c482f2-9ff8-4e14-96a4-8daf70dd9a22',
      storageId: null,
      virtualMachineName: 'virtualmachine89',
      vmImage: 'app/VM_image/2k.jpeg',
      title: 'virtualmachine89'

    }

    )
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.virtualMachine, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await specificVirtualMachine.Query.getSpecificVM(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
