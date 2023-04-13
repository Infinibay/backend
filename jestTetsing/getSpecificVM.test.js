import { PrismaClient } from '@prisma/client'
import specificVirtualMachine from '../app/graphql/resolvers/queries/specificVirtualMachine.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})

describe('specificVirtualMachine', () => {
  test('getSpecificVM', async () => {
    const mockInput = { input: { id: '59216324-6b36-4eec-8a1e-ad10e2855933' } }
    jest.spyOn(prisma.virtualMachine, 'findUnique').mockReturnValueOnce({ id: '59216324-6b36-4eec-8a1e-ad10e2855933' })
    const result = await specificVirtualMachine.Query.getSpecificVM(null, mockInput)
    expect(result).toEqual({
      user: {
        eMail: 'fizzafatima642@gmail.com',
        id: 'e1019b2a-804e-4280-a65d-79791f892207'
      },
      userId: 'e1019b2a-804e-4280-a65d-79791f892207',
      vmImage: 'app/VM_image/qz.jpeg',
      virtualMachineName: 'comp99',
      title: 'comp99',
      storageId: null,
      status: false,
      id: '59216324-6b36-4eec-8a1e-ad10e2855933',
      guId: '13e382b4-6ee0-45ed-a304-0c37d6f5021b',
      description: 'comp99',
      config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}'
    }

    )
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.virtualMachine, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await specificVirtualMachine.Query.getSpecificVM(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Something went wrong....please try again.!!!  ')
    }
  })
})
