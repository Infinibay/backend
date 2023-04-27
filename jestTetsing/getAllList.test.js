import { PrismaClient } from '@prisma/client'
import allVMResolver from '../app/graphql/resolvers/queries/getAllVM.js'
import forAllSO from '../app/graphql/resolvers/queries/allISO.js'
import getAllUserDisk from '../app/graphql/resolvers/queries/getAllUserDisk.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuth.js', () => {
  return jest
    .fn()
    .mockReturnValue({ id: 'cf4a0560-f11b-42b5-a0e5-77b0a8f44182' })
})

describe('allVMResolver', () => {
  test('getAllVM', async () => {
    const mockInput = { input: { id: 'cf4a0560-f11b-42b5-a0e5-77b0a8f44182' } }
    jest
      .spyOn(prisma.virtualMachine, 'findMany')
      .mockReturnValueOnce({ id: 'cf4a0560-f11b-42b5-a0e5-77b0a8f44182' })
    const result = await allVMResolver.Query.getAllVM(null, mockInput)
    expect(result).toEqual(
      [
        {
          user: {
            firstName: 'syeda',
            id: '33bfd355-bcf0-4b91-8a41-8389f497862e'
          },
          config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
          description: 'virtualmachine89',
          guId: '130fd53d-f0a1-49e1-aaff-bc7b756f4d52',
          id: '90c482f2-9ff8-4e14-96a4-8daf70dd9a22',
          status: true,
          title: 'virtualmachine89',
          virtualMachineName: 'virtualmachine89',
          vmImage: 'app/VM_image/2k.jpeg'

        }
      ]
    )
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.virtualMachine, 'delete').mockRejectedValue(new Error('mockError'))
    try {
      await allVMResolver.Query.getAllVM(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Something went wrong....please enter valid credentials .!!!  ')
    }
  })

  describe('getAllUserDisk', () => {
    test('getDiskDetails', async () => {
      jest.spyOn(prisma.disk, 'findMany').mockReturnValueOnce()
      const result = await getAllUserDisk.Query.getDiskDetails()
      expect(result).toEqual([
        {
          diskName: 'demo3',
          diskSize: 4,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6f7'
        },
        {
          diskName: 'demo1',
          diskSize: 4,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6f8'
        },
        {
          diskName: 'kkkk',
          diskSize: 2,
          id: '1481fdae-5f85-46ee-a664-567dea5d98dd'
        },
        {
          diskName: 'kkkk',
          diskSize: 2,
          id: '8b991d21-6069-4dd4-ada0-47b2d1150e46'
        },
        {
          diskName: 'newDisk88',
          diskSize: 2,
          id: '3de46c24-3aec-4eee-b5cb-529fd9c58b5f'
        },
        {
          diskName: 'newDisk88',
          diskSize: 2,
          id: '2899c5d4-6a6b-4715-8d4e-4819d19f8c4f'
        },
        {
          diskName: 'demo4',
          diskSize: 2,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6f6'
        },
        {
          diskName: 'demo5',
          diskSize: 2,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6f5'
        },
        {
          diskName: 'Test1',
          diskSize: 500,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a1'
        },
        {
          diskName: 'Test2',
          diskSize: 500,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a2'
        },
        {
          diskName: 'Test3',
          diskSize: 1000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a3'
        },
        {
          diskName: 'Test4',
          diskSize: 1000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a4'
        },
        {
          diskName: 'Test5',
          diskSize: 2000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a5'
        },
        {
          diskName: 'Test6',
          diskSize: 2000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a6'
        },
        {
          diskName: 'Test7',
          diskSize: 5000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a7'
        },
        {
          diskName: 'Test8',
          diskSize: 5000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6a8'
        },
        {
          diskName: 'Test9',
          diskSize: 3000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6fa9'
        },
        {
          diskName: 'Test10',
          diskSize: 3000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b1'
        },
        {
          diskName: 'Test11',
          diskSize: 1000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b2'
        },
        {
          diskName: 'Test12',
          diskSize: 1000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b3'
        },
        {
          diskName: 'Test13',
          diskSize: 500,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b4'
        },
        {
          diskName: 'Test14',
          diskSize: 500,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b5'
        },
        {
          diskName: 'Test15',
          diskSize: 4000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b6'
        },
        {
          diskName: 'Test16',
          diskSize: 4000,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b7'
        },
        {
          diskName: 'demo6',
          diskSize: 4,
          id: '0a166964-93e4-4171-a0c0-b9f91930f6b8'
        }
      ])
    })
    test('should throw an error if the function fails', async () => {
      jest.spyOn(prisma.disk, 'findMany').mockRejectedValue(new Error('mockError'))
      try {
        await getAllUserDisk.Query.getDiskDetails(null)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe('Failed to get Details ')
      }
    })
  })

  describe('forAllSO', () => {
    let mockInput
    beforeEach(() => {
      mockInput = {
        input: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNmNGEwNTYwLWYxMWItNDJiNS1hMGU1LTc3YjBhOGY0NDE4MiIsImVNYWlsIjoiYWRtaW5AZ21haWwuY29tIiwidXNlclR5cGUiOiJhZG1pbiIsImlhdCI6MTY4MTk3NTAyMCwiZXhwIjoxNzY4Mzc1MDIwfQ.HAtErXSkNMuKHskuPbsIte0e9Rh5MHU_ZWiaZADrUzg'
        }
      }
      jest.mock('../app/services/isAuth.js', () => {
        return jest.fn().mockImplementation(() => ({
          id: 'cf4a0560-f11b-42b5-a0e5-77b0a8f44182'
        }))
      })
    })
    afterEach(() => {
      jest.clearAllMocks()
    })
    afterAll(async () => {
      await prisma.$disconnect()
    })
    test('getAllISO', async () => {
      jest.spyOn(prisma.ISO, 'findMany').mockReturnValueOnce()
      const result = await forAllSO.Query.getAllISO(null, mockInput)
      expect(result).toEqual([
        {
          id: '0cc915c2-20d8-4862-b0a9-3cf970db92a1',
          name: 'newww.iso',
          size: 2,
          type: 'window',
          userId: '33bfd355-bcf0-4b91-8a41-8389f497862e'
        },
        {
          id: '95fb80ef-6788-4d83-aa85-90ace4a257d7',
          name: 'neewww.iso',
          size: 2,
          type: 'window',
          userId: '33bfd355-bcf0-4b91-8a41-8389f497862e'
        }
      ])
    })

    test('should throw an error if the function fails', async () => {
      jest.spyOn(prisma.ISO, 'findMany').mockRejectedValue(new Error('mockError'))
      try {
        await forAllSO.Query.getAllISO(null)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })
  })
})
