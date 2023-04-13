import { gql } from 'apollo-server-express'

const disk = gql`
  scalar Number
  type Query {
    "This Mutation is for users to get details of  disk by using token "
    getDiskDetails(input: getDiskDetailsInput): [Disk]

    "This Mutation is for user to get details of specific disk by using token "
    getSpecificDiskDetails(input: getSpecificDiskDetailsInput): [Disk]
  }
  type Mutation {
    "This Mutation is for users to create disk  by using token "
    createDisk(input: createDiskInput): Disk

    "This Mutation is for users to update disk  by using token "
    updateDisk(input: updateDiskInput): Disk

    "This Mutation is for users to delete disk  by using token "
    deleteDisk(input: deleteDiskInput): String
  }

  type Disk {
    id: ID
    diskName: String
    diskSize: Number
    storageId: Storage
    userId: User
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

  type Storage {
    id: ID
    storageName: String
    storageType: String
    storageSize: Number
    userId: User
  }

  input createDiskInput {
    diskName: String
    diskSize: Number
    storageId: ID
    token: String
  }

  input getDiskDetailsInput {
    token: String
  }
  input updateDiskInput {
    id: ID
    diskName: String
    diskSize: Number
    token: String
  }
  input deleteDiskInput {
    id: ID
    token: String
  }
  input getSpecificDiskDetailsInput {
    id: ID
    token: String
  }
`
export default disk
