const { gql, GraphQlUpload } = require('apollo-server-express')

const IOS = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date
  type Query {
    #--------------------------------FOR IOS--------------------------------------------------##
    
    "Users get their IOS by using token and IOS Id"
    getIOSById(input: forSearch): [IOS]
    
    "Admin get all users IOS "
    getAllIOS(input: forSearch): [IOS]
  }
  type Mutation {
    ##-----------------------------FOR IOS-----------------------------------------------------##
    "The createIOS Mutation is for users to create IOS by using token"
    createIOS(input: forIOS): IOS
    "Delete IOS by using IOS ID and token"
    deleteIOS(input: forIdToken): String
  },

  input forIdToken {
    id: ID
    token: String
 
  }
  input forSearch {
    token: String
    Search: String
  }
  input forIOS {
    Name: String
    Type: String
    userId: ID
    createdAt: Date
    Size: Number
    token: String
  }
  input for_only_id {
    id: ID
  }
  input id_token {
    id: ID
    Search: String
  }
  type IOS {
    id: ID
    Name: String
    Type: String
    userId: ID
    createdAt: Date
    Size: Number
  }
`
module.exports = IOS
