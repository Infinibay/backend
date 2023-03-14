const { gql, GraphQlUpload } = require('apollo-server-express');

const virtualMachine = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {

  ##------------------------------ FOR VIRTUAL MACHINE---------------------------------------##
  getAllVM(input: for_search_all): [VirtualMachine]
    getUserAllVM (input: for_search__user): [VirtualMachine]
 
    getSpecificVM(input: for_id_token): VirtualMachine
    # getUserVM(input: for_token): User
    getConfigFile: JSON
  },
  type Mutation {
    ##------------------------------FOR VIRTUAL MACHINE----------------------------------------##
    createVM(input: For_VirtualMachine): VirtualMachine
    upadteVM(input: VM): VirtualMachine
    deleteVM(input: for_ids_token): String
    Upload_Image(input: image): photo
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
  input for_ids_token{
    id:[ID]
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
  input For_VirtualMachine{
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
  input for_id_token {
    id:ID
    token: String
  }
  input for_search_all{
  token: String
    Search: String
    Status: Boolean
}
input  for_search__user {
  token: String
  Status: Boolean
}


  `;
module.exports = virtualMachine;
