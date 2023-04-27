import { gql } from 'apollo-server-express'
const ISO = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date
  type Query {
    "Users get their ISO by using token and ISO Id"
    getISOById(input: getISOByIdInput): [ISO]

    "Admin get all users ISO "
    getAllISO(input: getAllISOInput): [ISO]
  }
  type Mutation {
    "The createISO Mutation is for users to create ISO by using token"
    createISO(input: createISOInput): ISO

    "The updateISO Mutation is for users to update type of ISO by using token"
    updateISO(input: updateISOInput): ISO

    "Delete ISO by using ISO ID and token"
    deleteISO(input: deleteISOInput): String
  }

  type ISO {
    id: ID
    name: String
    type: String
    userId: ID
    createdAt: Date
    size: Number
  }

  input getISOByIdInput {
    token: String
    search: String
  }

  input getAllISOInput {
    token: String
    search: String
  }

  input createISOInput {
    name: String
    type: String
    createdAt: Date
    size: Number
    token: String
  }

  input deleteISOInput {
    id:[ID]
    token: String
  }
  input updateISOInput {
    id: ID
    token: String
    type: String
  }
`
export default ISO
