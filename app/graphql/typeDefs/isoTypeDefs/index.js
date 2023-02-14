import { gql } from "apollo-server-express"
const ISO = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date
  type Query {
    #--------------------------------FOR ISO--------------------------------------------------##

    "Users get their ISO by using token and ISO Id"
    getISOById(input: getISOByIdInput): [ISO]

    "Admin get all users ISO "
    getAllISO(input: getAllISOInput): [ISO]
  }
  type Mutation {
    ##-----------------------------FOR ISO-----------------------------------------------------##
    "The createISO Mutation is for users to create ISO by using token"
    createISO(input: createISOInput): ISO

    "Delete ISO by using ISO ID and token"
    deleteISO(input: deleteISOInput): String
  }

  type ISO {
    id: ID
    Name: String
    Type: String
    userId: ID
    createdAt: Date
    Size: Number
  }

  input getISOByIdInput {
    token: String
    Search: String
  }

  input getAllISOInput {
    token: String
    Search: String
  }

  input createISOInput {
    Name: String
    Type: String
    createdAt: Date
    Size: Number
    token: String
  }

  input deleteISOInput {
    id: ID
    token: String
  }
`;
export default ISO;
