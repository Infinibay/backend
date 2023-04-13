import { PrismaClient } from '@prisma/client'
import updateVMResolvers from '../app/graphql/resolvers/mutations/updateVM.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('updateVMResolvers function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTk4ODIzLCJleHAiOjE3Njc1OTg4MjN9.BVQZxyrs_Cdyl7G3kiQpgjZ8L3YDIwshe_aq1IATNsw',
        virtualMachineName: 'comp99',
        title: 'comp99',
        status: false,
        id: '59216324-6b36-4eec-8a1e-ad10e2855933',
        description: 'comp99',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207'
      }
    }

    jest.mock('../app/services/isAuthForBoth.js', () => {
      return jest.fn().mockImplementation(() => ({
        id: 'e1019b2a-804e-4280-a65d-79791f892207'
      }))
    })
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  test('should update a vm in the database', async () => {
    const result = await updateVMResolvers.Mutation.upadteVM(null, mockInput)
    expect(result).toEqual({
      virtualMachineName: 'comp99',
      title: 'comp99',
      id: '59216324-6b36-4eec-8a1e-ad10e2855933',
      description: 'comp99',
      status: false
    })
    const updatedVM = await prisma.virtualMachine.findUnique({
      where: { id: result.id }
    })
    expect(updatedVM).toEqual({
      config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
      description: 'comp99',
      guId: '13e382b4-6ee0-45ed-a304-0c37d6f5021b',
      id: '59216324-6b36-4eec-8a1e-ad10e2855933',
      status: false,
      storageId: null,
      title: 'comp99',
      userId: 'e1019b2a-804e-4280-a65d-79791f892207',
      virtualMachineName: 'comp99',
      vmImage: 'app/VM_image/qz.jpeg'
    })
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.virtualMachine, 'update').mockRejectedValue(new Error('mockError'))

    try {
      await updateVMResolvers.Mutation.upadteVM(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Failed to Update')
    }
  })
})
