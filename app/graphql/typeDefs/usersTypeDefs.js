import { gql } from "apollo-server-express"

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
    ##--------------------------------FOR USER-------------------------------------------------##
    "For Signup-User"
    createUser(input: createUserInput): User

    " User can update their profile by using token"
    updateUser(input: updateUserInput): User

    "Only Admin can delete the user by using User Id."
    deleteUser(input: deleteUserInput): String

    "User can login by using Valid Email and Password."
    Login(input: LoginInput): User

    "This forgetPassword Mutation send user verified token through their email for reset password"
    forgetPassword(input: forgetPasswordInput): String

    "The resetPassword Mutation is used to reset the password by using Mail token"
    resetPassword(input: resetPasswordInput): String
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

  input getUserListInput {
    token: String
    Search: String
    page: Number
    # perpage: Number
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
    Email: String
    Password: String
    Deleted: Boolean
    userImage: String
    userType: String
  }

  input updateUserInput {
    firstName: String
    lastName: String
    Email: String
    Password: String
    Deleted: Boolean
    token: String
    userImage: String
    userType: String
  }

  input deleteUserInput {
    id: ID
    token: String
  }

  input LoginInput {
    Email: String
    Password: String
  }

  input forgetPasswordInput {
    Email: String
  }
  input resetPasswordInput {
    # Email : String
    Password: String
    token: String
  }
`;
export default user;
