import { PrismaClient } from '@prisma/client'
import createVMResolvers from '../app/graphql/resolvers/mutations/createVM.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('createVMResolvers function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgwODUxNTU3LCJleHAiOjE3NjcyNTE1NTd9.8mRP4L-iWLBtHKr51ZBoYGdPYBHLP6C27aGu8KnH4HQ',
        config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
        description: '1234vm',
        guId: '1279142f-5057-489b-b2d3-bcbe679df0ad',
        status: false,
        id: 'bae1ffb0-c04a-4d57-8f0c-3bb114249aa2',
        storageId: null,
        title: null,
        virtualMachineName: '1234vm',
        vmImage: 'app/VM_image/88.jpeg'

      }
    }
    jest.mock('../app/services/isAuthForBoth.js', () => {
      return jest.fn().mockImplementation(() => ({
        id: 'e1019b2a-804e-4280-a65d-79791f892207'
      }))
    })
  }
  )
  afterEach(() => {
    jest.clearAllMocks()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  test('create new vm in the database', async () => {
    const forresult = await createVMResolvers.Mutation.createVM(null, mockInput)
    expect(forresult).toEqual({
      id: expect.any(String),
      guId: expect.any(String),
      config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
      description: '1234vm',
      guId: '1279142f-5057-489b-b2d3-bcbe679df0ad',
      status: false,
      id: 'bae1ffb0-c04a-4d57-8f0c-3bb114249aa2',
      storageId: null,
      title: null,
      virtualMachineName: '1234vm',
      vmImage: 'app/VM_image/88.jpeg'
    })
    const createVM = await prisma.virtualMachine.findUnique({
      where: {
        id: forresult.id
      }
    })
    expect(createVM).toEqual({
      id: expect.any(String),
      guId: expect.any(String),
      config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
      description: '1234vm',
      guId: '1279142f-5057-489b-b2d3-bcbe679df0ad',
      status: false,
      id: 'bae1ffb0-c04a-4d57-8f0c-3bb114249aa2',
      storageId: null,
      title: null,
      virtualMachineName: '1234vm',
      vmImage: 'app/VM_image/88.jpeg'

    })
  })
  test('if any error. throw an error if the function fails', async () => {
    jest.spyOn(prisma.virtualMachine, 'create').mockRejectedValue(new Error('mockError'))
    try {
      await createVMResolvers.Mutation.createVM(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Failed to Create')
    }
  })
})
