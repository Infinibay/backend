import { PrismaClient } from '@prisma/client'
import allUserVMResolver from '../app/graphql/resolvers/queries/userVirtualMachines.js'
import { describe, expect, test } from '@jest/globals'
const prisma = new PrismaClient()
jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})
describe('allUserVMResolver', () => {
  test('getUserAllVM', async () => {
    const mockInput = { input: { userId: 'e1019b2a-804e-4280-a65d-79791f892207' } }
    jest.spyOn(prisma.user, 'findMany').mockReturnValueOnce({ userId: 'e1019b2a-804e-4280-a65d-79791f892207' })
    const result = await allUserVMResolver.Query.getUserAllVM(null, mockInput)
    expect(result).toEqual([
      {
        user: {
          id: 'e1019b2a-804e-4280-a65d-79791f892207'
        },
        vmImage: 'app/VM_image/qz.jpeg',
        virtualMachineName: 'addVM',
        title: 'addVM',

        status: false,
        id: '59216324-6b36-4eec-8a1e-ad10e2855933',
        description: 'addVM',
        config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
        guId: '13e382b4-6ee0-45ed-a304-0c37d6f5021b'
      },
      {
        user: {
          id: 'e1019b2a-804e-4280-a65d-79791f892207'
        },
        vmImage: 'app/VM_image/fk.jpeg',
        virtualMachineName: 'VM12',
        title: 'VM12',

        status: false,
        id: 'c3cf2cfb-0210-44f3-81e8-273340068522',
        description: 'VM12',
        config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
        guId: '1d0ae701-35b4-4aa0-b308-2cf684562527'
      },
      {
        user: {
          id: 'e1019b2a-804e-4280-a65d-79791f892207'
        },
        vmImage: 'app/VM_image/tf.jpeg',
        virtualMachineName: '123vm',
        title: '123vm',

        status: false,
        id: '1b54760b-8885-4a79-aa02-413a623c271f',
        description: '123vm',
        config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
        guId: 'd067c9c7-4bf3-4c60-9a55-8387c88951b9'
      },
      {
        user: {
          id: 'e1019b2a-804e-4280-a65d-79791f892207'
        },
        vmImage: 'app/VM_image/tcj.jpeg',
        virtualMachineName: 'vm89',
        title: 'vm89',

        status: false,
        id: '56b90d8b-afb8-48b8-8e1b-be0b94304116',
        description: 'vm89',
        config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
        guId: '127c05b2-b10e-49d7-9448-d40fe50b2386'
      },
      {
        user: {
          id: 'e1019b2a-804e-4280-a65d-79791f892207'
        },
        vmImage: 'app/VM_image/88.jpeg',
        virtualMachineName: '1234vm',
        title: '1234vm',

        status: false,
        id: 'bae1ffb0-c04a-4d57-8f0c-3bb114249aa2',
        description: '1234vm',
        config: '{"getConfigFile":{"Memory":2080,"processor":{"Processors":"2","Virtualization Engine":""},"Hard Disk (SCSI)":{"Disk file":"","Capacity":"","Disk Information":"","Disk Utitlites":"","Advance":{"Virtual Device Node":""}},"CD/DVD 2(SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"CD/DVD (SATA)":{"Device Status":"","Connection":"","Advance":{"Virtual Device Node":"","Troubleshooting":""}},"Floppy":{"Device Status":"","Connection":""},"Network Adapter":{"Device Status":""," Network Connection":"","Advance":{"Incoming Transfer":"","Outcoming Transfer":"","MAC Address":""}},"USB Controller":{"Connection":""},"Sound Card":{"Device Status":"","Connection":"","Echo Cancellation":""},"Printer":"","Display":{"3D graphics":"","Monitors":"","Graphics Memory":""},"Storage":8.2,"Data":{"First_Name":"","Last_Name":"","Passowrd":"","Confirm_Passowrd":""},"Operating System":"","OS_Version":"","VirtualMachine_Name":"","VirtualMachine_Locatiom":"","Operating_System":"Linux","IsoFile":"lubuntu-22.04.1-desktop-amd64.iso","TPM":false}}',
        guId: '1279142f-5057-489b-b2d3-bcbe679df0ad'
      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.virtualMachine, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await allUserVMResolver.Query.getUserAllVM(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
