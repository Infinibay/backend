import { gql } from 'apollo-server-express'

const storage = gql`
  scalar Number
  type Query {
    "This Mutation is for users to get details of  Storage Pool by using token "
    getStorageList(input: getStorageListInput): [Storage]

    getStorageDetailsDisk(input: getStorageDetailsDisInput ) : StorageDisk
  } 
  type Mutation {
    "This Mutation is for users to add Storage Pool by using token "
    createStorage(input: createStorageInput): Storage

    "This Mutation is for users to update Storage Pool by using token "
    updateStorage(input: updateStorageInput): Storage

    "This Mutation is for user to delete Storage pool by using token "
    deleteStoragePool(input: deleteStorageInput): String
  }

  type StorageDisk {
  storage: [Storage]
  disk: [Disk]
}

type Disk {
  id: ID
    diskName: String
    diskSize: Number
    storageId: Storage
}

  type Storage {
    id: ID
    storageName: String
    storageType: String
    storageSize: Number
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

  input createStorageInput {
    storageName: String
    storageType: String
    storageSize: Number
    token: String
  }
  input getStorageListInput {
    token: String
  }
  input updateStorageInput {
    storageName: String
    storageType: String
    storageSize: Number
    token: String
    id: ID
  }
  input deleteStorageInput {
    id: ID
    token: String
  }
  input getStorageDetailsDisInput {
    id: ID
    token: String
  }
`
export default storage
