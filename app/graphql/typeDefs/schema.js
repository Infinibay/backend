const { gql, GraphQlUpload } = require("apollo-server-express");

const typeDefs = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {
    ##--------------------------------FOR USER-------------------------------------------------##
    getUserList(input: forSearch): [User]
    getUserByID(input: forIdToken): User

    ##------------------------------ FOR VIRTUAL MACHINE---------------------------------------##
    getAllVM(input: forSearchAll): [VirtualMachine]
    getUserAllVm (input: forSearchUser): [VirtualMachine]
 
    getSpecificVM(input: forIdToken): VirtualMachine
    getUserVM(input: forToken): User
    getConfigFile: JSON

    ##-------------------------------FOR NOTIFICATION-----------------------------------------##
    getNotification: [Notification]
    getUserNotification (input: forToken ):[Notification]

    #--------------------------------FOR IOS--------------------------------------------------##
    getISOById(input: forSearch): [IOS]
    getAllISO(input: forSearch): [IOS]
  }
  type Mutation {
    ##--------------------------------FOR USER-------------------------------------------------##
    createUser(input: UserInput): User
    UpdateUser(input: UserInput): User
    DeleteUser(input: forIdToken): String
    login(input: forLogin): User
    SendEmail(input: UserInput): User
    ForgetPassword(input: forgetPassword): String
    ResetPassword(input: Authentication): String

    ##------------------------------FOR VIRTUAL MACHINE----------------------------------------##
    createVM(input: forVirtualMachine): VirtualMachine
    upadteVM(input: VM): VirtualMachine
    deleteVM(input: forIdsToken): String
    uploadImage(input: image): photo
    forStatus(input: status): String

    ##------------------------------FOR NOTIFICATION-------------------------------------------##
    addNotification(input: notificationVM): Notification
    updateNotification(input: forUpdateNotication): String
    deleteNotification(input: forOnlyId): String

    ##-----------------------------FOR IOS-----------------------------------------------------##
    createISO(input: forIOS): IOS
    deleteISO(input: forOnlyId): String
  }

  type IOS {
    id: ID
    Name: String
    Type: String
    userId: ID
    createdAt: Date
    Size: Number
  }
  input forIOS {
    Name: String
    Type: String
    userId: ID
    createdAt: Date
    Size : Number
  }
    



  input UserInput {
    id: ID
    firstName: String
    lastName: String
    Email: String
    Password: String
    Deleted: Boolean
    token: String
    userImage: String
    userType: String
  }
  input Authentication {
    # Email : String
    Password: String
    token: String
  }

  input forOnlyId {
    id: ID
  }

  input forgetPassword {
    Email: String
  }
  input status {
    id: ID
    token: String
    button: Boolean
  }
  input forIdToken {
    id:ID
    token: String
  }
  input forIdsToken{
    id:[ID]
    token: String

  }
  input forToken {
    token: String
  }
  input forSearch {
    token: String
    search: String
  }
input forSearchAll{
  token: String
    search: String
    Status: Boolean
}

input  forSearchUser {
  token: String
  Status: Boolean
}

  input forLogin {
    Email: String
    Password: String
  }
  type photo {
    vmImage: String
    Status: Boolean
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
    _count: Number
    userType: String
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


  input forVirtualMachine{
    virtualMachineName: String
    Title: String
    Description: String
    Status: Boolean
    Config: String
    vmImage: String
    token: String
  }

  type Notification {
    id: ID
    Message: String
    userId: ID
    vm_id: ID
    Readed: Boolean
  }
  input notificationVM {
    Message: String
    userId: ID
    vm_id: ID
    Readed: Boolean
  }
  input forUpdateNotication {
    userId: ID
    Readed: Boolean
  }

  type VirtualMachine {
    id: ID
    GU_ID: ID
    Config: String
    Status: Boolean
    virtualMachineName: String
    Title: String
    Description: String
    userId: User
    vmImage: String
  }

  input image {
    vmImage: String
  }

  type AuthPlayload {
    token: String
    userId: User
  }
`;
module.exports = typeDefs;
