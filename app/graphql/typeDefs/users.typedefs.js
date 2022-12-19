const { gql, GraphQlUpload } = require("apollo-server-express");

const user = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {
    getUserList(input: for_search): [User]
    getUserByID(input: for_id_token): User
    getConfigFile: JSON
    getUserVM(input: for_token): User
   
  }
  type Mutation {
    ##--------------------------------FOR USER-------------------------------------------------##
    createUser(input: userInput): User
    updateUser(input: userInput): User
    deleteUser(input: for_id_token): String
    Login(input: for_login): User
    sendEmail(input: userInput): User
    forgetPassword(input: forget_password): String
    resetPassword(input: Authentication): String
  }
  input for_token {
    token: String
  }

  input for_search {
    token: String
    Search: String
  }
  input for_id_token {
    id: ID
    token: String
  }

  input for_login {
    Email: String
    Password: String
  }

  input forget_password {
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
`;
module.exports = user;
