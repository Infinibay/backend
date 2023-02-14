import { gql } from "apollo-server-express"

const virtualMachine = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {
    ##------------------------------ FOR VIRTUAL MACHINE---------------------------------------##
    "The getAllVM query is only for Admin to get All Virtual Machine."
    getAllVM(input: getAllVMInput): [VirtualMachine]

    "This getUserAllVM query is for users to get their Virtual Machine by using token."
    getUserAllVM(input: getUserAllVMInput): [VirtualMachine]

    "This getSpecificVM query is for users to get their specific VM by using VirtualMachine ID and token."
    getSpecificVM(input: getSpecificVMInput): VirtualMachine

    " This getConfigFileis used to get Config File"
    getConfigFile: JSON
    #  "Find Virtual Machine Name exit or not"
    findVMName(input: findVMNameInput): String
  }
  type Mutation {
    ##------------------------------FOR VIRTUAL MACHINE----------------------------------------##
    " Users can create Virtual Machine by using token "
    createVM(input: createVMInput): VirtualMachine
    "Users can update their Virtual Machine by using Vitual Machine ID and token "
    upadteVM(input: upadteVMInput): VirtualMachine

    "This Mutation is for users to delete their Virtual Machine by using their and VirtualMachine ID "
    deleteVM(input: deleteVMInput): String

    "The forStatus Mutation  is for turn Virtual Machine ON and OFF"
    forStatus(input: forStatusInput): String
  }
  type User {
    id: ID
    firstName: String
    lastName: String
    Email: String
    Password: String
    Deleted: Boolean
    token: String
    userImage: String
    userType: String
    _count: Number
  }

  type VirtualMachine {
    id: ID
    guId: ID
    Config: String
    Status: Boolean
    virtualMachineName: String
    Title: String
    Description: String
    userId: User
    vmImage: String
  }

  input getAllVMInput {
    token: String
    Search: String
    Status: Boolean
  }

  input getUserAllVMInput {
    token: String
    Status: Boolean
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
    Title: String
    Description: String
    Status: Boolean
    Config: String
    vmImage: String
    token: String
  }

  input upadteVMInput {
    id: ID
    virtualMachineName: String
    Title: String
    Description: String
    Status: Boolean
    Config: String
    vmImage: String
    token: String
  }

  input deleteVMInput {
    id: [ID]
    token: String
  }

  input forStatusInput {
    id: ID
    token: String
    button: Boolean
  }
`;
export default virtualMachine;
