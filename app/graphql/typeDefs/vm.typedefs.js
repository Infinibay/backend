const { gql, GraphQlUpload } = require('apollo-server-express')

const virtualMachine = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {
    ##------------------------------ FOR VIRTUAL MACHINE---------------------------------------##
    "The getAllVM query is only for Admin to get All Virtual Machine."
    getAllVM(input: forgetVM): [VirtualMachine]

    "This getUserAllVM query is for users to get their Virtual Machine by using token."
    getUserAllVM(input: forSearchUser): [VirtualMachine]

    "This getSpecificVM query is for users to get their specific VM by using VirtualMachine ID and token."
    getSpecificVM(input: forIdToken): VirtualMachine

    " This getConfigFileis used to get Config File"
    getConfigFile: JSON
  },
  type Mutation {
    ##------------------------------FOR VIRTUAL MACHINE----------------------------------------##
    " Users can create Virtual Machine by using token "
    createVM(input: ForVirtualMachine): VirtualMachine
    "Users can update their Virtual Machine by using Vitual Machine ID and token "
    upadteVM(input: VM): VirtualMachine

    "This Mutation is for users to delete their Virtual Machine by using their and VirtualMachine ID "
    deleteVM(input: forIdsToken): String
    # uploadImage(input: image): photo

    "The forStatus Mutation  is for turn Virtual Machine ON and OFF"
    forStatus(input: status): String
  }
  type User {
    id: ID
    First_Name: String
    Last_Name: String
    Email: String
    Password: String
    Deleted: Boolean
    token: String
    User_Image: String
    User_Type: String
    _count: Number
  }

  type VirtualMachine {
    id: ID
    GU_ID: ID
    Config: String
    Status: Boolean
    VirtualMachine_Name: String
    Title: String
    Description: String
    userId: User
    VM_Image: String
  }
  type photo {
    VM_Image: String
    Status: Boolean
  }
  input status {
    id: ID
    token: String
    button: Boolean
  }
  input forIdsToken {
    id: [ID]
    token: String
  }
  input image {
    VM_Image: String
  }

  input VM {
    id: ID
    virtualMachineName: String
    Title: String
    Description: String
    Status: Boolean
    userId: ID
    Config: String
    vmImage: String
    token: String
  }
  input ForVirtualMachine {
    virtualMachineName: String
    Title: String
    Description: String
    Status: Boolean
    Config: String
    vmImage: String
    token: String
  }
  input for_token {
    token: String
  }
  input forIdToken {
    id: ID
    token: String
  }
  input forgetallVM {
    Search: String
    Status: Boolean
  }
  input forgetVM {
    token: String
    Search: String
    Status: Boolean
  }
  input for_search_all {
    token: String
    Search: String
    Status: Boolean
  }
  input forSearchUser {
    token: String
    Status: Boolean
  }
`
module.exports = virtualMachine
