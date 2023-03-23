import { gql } from 'apollo-server-express'

const virtualMachine = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {
    "The getAllVM query is only for Admin to get All Virtual Machine."
    getAllVM(input: getAllVMInput): [VirtualMachine]

    "This getUserAllVM query is for users to get their Virtual Machine by using token."
    getUserAllVM(input: getUserAllVMInput): [VirtualMachine]

    "This getSpecificVM query is for users to get their specific VM by using VirtualMachine ID and token."
    getSpecificVM(input: getSpecificVMInput): VirtualMachine

    "Virtual Machine Name exit or not"
    findVMName(input: findVMNameInput): String
  }
  type Mutation {
    " Users can create Virtual Machine by using token "
    createVM(input: createVMInput): VirtualMachine
    "Users can update their Virtual Machine by using Vitual Machine ID and token "
    upadteVM(input: upadteVMInput): VirtualMachine

    "This Mutation is for users to delete their Virtual Machine by using their and VirtualMachine ID "
    deleteVM(input: deleteVMInput): String

    "The forstatus Mutation  is for turn Virtual Machine ON and OFF"
    forStatus(input: forstatusInput): String
  }
  type User {
    id: ID
    firstName: String
    lastName: String
    eMail: String
    password: String
    deleted: Boolean
    token: String
    userImage: String
    userType: String
    _count: Number
  }

  type VirtualMachine {
    id: ID
    guId: ID
    config: String
    status: Boolean
    virtualMachineName: String
    title: String
    description: String
    userId: User
    vmImage: String
    storageId: ID
  }

  input getAllVMInput {
    token: String
    search: String
    status: Boolean
  }

  input getUserAllVMInput {
    token: String
    status: Boolean
  }

  input getSpecificVMInput {
    id: ID
    token: String
  }

  input findVMNameInput {
    virtualMachineName: String
  }

  input createVMInput {
    virtualMachineName: String
    title: String
    description: String
    status: Boolean
    config: String
    vmImage: String
    token: String
    storageId: ID
  }

  input upadteVMInput {
    id: ID
    virtualMachineName: String
    title: String
    description: String
    status: Boolean
    config: String
    vmImage: String
    token: String
  }

  input deleteVMInput {
    id: [ID]
    token: String
  }

  input forstatusInput {
    id: ID
    token: String
    button: Boolean
  }
`
export default virtualMachine
