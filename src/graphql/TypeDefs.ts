import { gql } from 'apollo-server-express';

export const typeDefs = gql`

type User {
  id: ID!
  email: String!
  firstName: String!
  lastName: String!
  createdAt: String!
  updatedAt: String!
}

type VirtualMachine {
  id: ID!
  name: String!
  description: String
  vcpu: Int!
  ram: Int!
  os: String
  version: String
  createdAt: String!
  updatedAt: String!
}

# Mutations responses
type FieldError {
  field: String!
  message: String!
}

type LoginError {
  message: String!
}

type LoginResponse {
  token: String
  user: User
  errors: LoginError
}

type craeteVmResponse {
  vm: VirtualMachine
  errors: [FieldError!]
}

type CurrentUserResponse {
  user: User
  error: String
}

type Query {
  logIn(email: String!, password: String!): LoginResponse!
  currentUser: CurrentUserResponse
}

type Mutation {
  createVm(name: String!, description: String, vcpu: Int!, ram: Int!, os: String, version: String): VirtualMachine!
}
`;