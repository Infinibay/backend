const { gql, GraphQlUpload } = require('apollo-server-express')

const IOS = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date
  type Query {
    #--------------------------------FOR IOS--------------------------------------------------##
    getIOSById(input: for_search): [IOS]
    getAllIOS(input: for_search): [IOS]
  }
  type Mutation {
    ##-----------------------------FOR IOS-----------------------------------------------------##
    createIOS(input: for_IOS): IOS
    deleteIOS(input: for_id_token): String
  }
  input for_search {
    token: String
    Search: String
  }
  input for_IOS {
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
