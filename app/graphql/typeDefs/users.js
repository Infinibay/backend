import { gql } from 'apollo-server-express'

const user = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date
  type Query {
    "This Query is for Admin to get users list by using token"
    getUserList(input: getUserListInput): [User]
    "getUserByID query used by users to view their profile"
    getUserByID(input: getUserByIDInput): User
    "getConfigFile is for get config file"
    getConfigFile: JSON
    getUserVM(input: getUserVMInput): User
  }
  type Mutation {
    "For Signup-User"
    createUser(input: createUserInput): User
    " User can update their profile by using token"
    updateUser(input: updateUserInput): User
    "Only Admin can delete the user by using User Id."
    deleteUser(input: deleteUserInput): String
    "User can login by using Valid eMail and password."
    Login(input: LoginInput): User
    "This forgetpassword Mutation send user verified token through their eMail for reset password"
    forgetPassword(input: forgetpasswordInput): String
    "The resetpassword Mutation is used to reset the password by using Mail token"
    resetPassword(input: resetpasswordInput): String
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

  input getUserListInput {
    token: String
    search: String
    page: Number
  }


  input getUserByIDInput {
    token: String
  }
  input getUserVMInput {
    token: String
  }
  input createUserInput {
    firstName: String
    lastName: String
    eMail: String
    password: String
    deleted: Boolean
    userImage: String
    userType: String
  }
  input updateUserInput {
    firstName: String
    lastName: String
    eMail: String
    password: String
    deleted: Boolean
    token: String
    userImage: String
    userType: String
  }
  input deleteUserInput {
    id: ID
    token: String
  }
  input LoginInput {
    eMail: String
    password: String
  }
  input forgetpasswordInput {
    eMail: String
  }
  input resetpasswordInput {
    # eMail : String
    password: String
    token: String
  }


  
`
export default user
