// const { gql, GraphQlUpload } = require("apollo-server-express");

// const typeDefs = gql`
//   scalar JSON
//   scalar Number
//   scalar Upload
//   scalar Date

//   type Query {
//     ##--------------------------------FOR USER-------------------------------------------------##
//     getUserList(input: for_search): [User]
//     getUserByID(input: for_id_token): User

//     ##------------------------------ FOR VIRTUAL MACHINE---------------------------------------##
//     getAllVM(input: for_search_all): [VirtualMachine]
//     getUserAllVM (input: for_search__user): [VirtualMachine]
 
//     getSpecificVM(input: for_id_token): VirtualMachine
//     getUserVM(input: for_token): User
//     getConfigFile: JSON

//     ##-------------------------------FOR NOTIFICATION-----------------------------------------##
//     getNotification: [Notification]
//     getUserNotification (input: for_token ):[Notification]

//     #--------------------------------FOR IOS--------------------------------------------------##
//     getIOSById(input: for_search): [IOS]
//     getAllIOS(input: for_search): [IOS]
//   }
//   type Mutation {
//     ##--------------------------------FOR USER-------------------------------------------------##
//     createUser(input: userInput): User
//     updateUser(input: userInput): User
//     deleteUser(input: for_id_token): String
//     Login(input: for_login): User
//     sendEmail(input: userInput): User
//     forgetPassword(input: forget_password): String
//     resetPassword(input: Authentication): String

//     ##------------------------------FOR VIRTUAL MACHINE----------------------------------------##
//     createVM(input: For_VirtualMachine): VirtualMachine
//     upadteVM(input: VM): VirtualMachine
//     deleteVM(input: for_ids_token): String
//     Upload_Image(input: image): photo
//     forStatus(input: status): String

//     ##------------------------------FOR NOTIFICATION-------------------------------------------##
//     addNotification(input: Notification_VM): Notification
//     updateNotification(input: forUpdateNotication): String
//     deleteNotification(input: for_only_id): String

//     ##-----------------------------FOR IOS-----------------------------------------------------##
//     createIOS(input: for_IOS): IOS
//     deleteIOS(input: for_only_id): String
//   }

//   type IOS {
//     id: ID
//     Name: String
//     Type: String
//     userId: ID
//     createdAt: Date
//     Size: Number
//   }
//   input for_IOS {
//     Name: String
//     Type: String
//     userId: ID
//     createdAt: Date
//     Size : Number
//   }
    



//   input userInput {
//     id: ID
//     firstName: String
//     lastName: String
//     Email: String
//     Password: String
//     Deleted: Boolean
//     token: String
//     userImage: String
//     userType: String
//   }
//   input Authentication {
//     # Email : String
//     Password: String
//     token: String
//   }

//   input for_only_id {
//     id: ID
//   }

//   input forget_password {
//     Email: String
//   }
//   input status {
//     id: ID
//     token: String
//     button: Boolean
//   }
//   input for_id_token {
//     id:ID
//     token: String
//   }
//   input for_ids_token{
//     id:[ID]
//     token: String

//   }
//   input for_token {
//     token: String
//   }
//   input for_search {
//     token: String
//     Search: String
//   }
// input for_search_all{
//   token: String
//     Search: String
//     Status: Boolean
// }

// input  for_search__user {
//   token: String
//   Status: Boolean
// }

//   input for_login {
//     Email: String
//     Password: String
//   }
//   type photo {
//     VM_Image: String
//     Status: Boolean
//   }
//   type User {
//      id: ID
//      First_Name: String
//      Last_Name: String
//     Email: String
//     Password: String
//     Deleted: Boolean
//     token: String
//     User_Image: String
//     User_Type: String
//     _count: Number

 
  
//   }

 
//   input VM {
//     id: ID
//     virtualMachineName: String
//     Title: String
//     Description: String
//     Status: Boolean
//     userId: ID
//     Config: String
//     vmImage: String
//     token: String
//   }


//   input For_VirtualMachine{
//     virtualMachineName: String
//     Title: String
//     Description: String
//     Status: Boolean
//     Config: String
//     vmImage: String
//     token: String
//   }

//   type Notification {
//     id: ID
//     Message: String
//     userId: ID
//     vm_id: ID
//     Readed: Boolean
//   }
//   input Notification_VM {
//     Message: String
//     userId: ID
//     vmId: ID
//     Readed: Boolean
//   }
//   input forUpdateNotication {
//     userId: ID
//     Readed: Boolean
//   }

//   type VirtualMachine {
//     id: ID
//     GU_ID: ID
//     Config: String
//     Status: Boolean
//     VirtualMachine_Name: String
//     Title: String
//     Description: String
//     userId: User
//     VM_Image: String
//   }

//   input image {
//     VM_Image: String
//   }

//   type AuthPlayload {
//     token: String
//     userId: User
//   }
// `;
// module.exports = typeDefs;
