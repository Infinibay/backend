const { gql, GraphQlUpload } = require('apollo-server-express')

const user = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {
    "This Query is for Admin to get users list by using token"
    getUserList(input: forSearch): [User]
    "getUserByID query used by users to view their profile"
    getUserByID(input: forIdToken): User
    "getConfigFile is for get config file"
    getConfigFile: JSON 

    getUserVM(input: forToken): User
  }
  type Mutation {
    ##--------------------------------FOR USER-------------------------------------------------##
    "For Signup-User"
    createUser(input: userInput): User

   " User can update their profile by using token"
    updateUser(input: userInput): User

    "Only Admin can delete the user by using User Id."
    deleteUser(input: forIdToken): String

    "User can login by using Valid Email and Password."
    Login(input: forLogin): User

    sendEmail(input: userInput): User
    "This forgetPassword Mutation send user verified token through their email for reset password"
    forgetPassword(input: forgetPassword): String

    "The resetPassword Mutation is used to reset the password by using Mail token"
    resetPassword(input: Authentication): String
  }
  input forToken {
    token: String
  }

  input forSearch {
    token: String
    Search: String
  }
  input forIdToken {
    id: ID
    token: String
  }
  input forLogin {
    Email: String
    Password: String
  }
  input forgetPassword {
    Email: String
  }
  input Authentication {
    # Email : String
    Password: String
    token: String
  }
  input userInput {
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
`
module.exports = user
