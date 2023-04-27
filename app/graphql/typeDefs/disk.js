import { gql } from 'apollo-server-express'

const disk = gql`
  scalar Number
  type Query {
    "This Query is for users to get details of  disk by using token "
    getDiskDetails: [Disk]

    "This Query is for user to get details of specific disk by using token "
    getSpecificDiskDetails(input: getSpecificDiskDetailsInput): Disk

    "This Query show the list of UnAssigned Disk"
    getUnAssignedDisk: [Disk]

"This Query for get Assigned Disk List"
    getAssignedDisk: [Disk]

"This Query for get disk having same storageid"
getListOfStorageDetails(input: getListOfStorageDetailsInput): [Disk]

  }
  type Mutation {
    "This Mutation is for users to create disk  by using token "
    createDisk(input: createDiskInput): Disk

    "This Mutation is for users to update disk  by using token "
    updateDisk(input: updateDiskInput): Disk

    "This Mutation is for users to delete disk  by using token "
    deleteDisk(input: deleteDiskInput): String

"This Mutation is used to Assinged StorageId to DiskID"
    UpdateDiskStorageId(input: updateDiskStorageInput): String
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

  input createDiskInput {
    diskName: String
    diskSize: Number
    storageId: ID
  }

  # input getDiskDetailsInput {
  #   token: String
  # }
  input updateDiskInput {
    id: ID
    diskName: String
    diskSize: Number
  }
  input deleteDiskInput {
    id: ID
    # token: String
  }
  input getSpecificDiskDetailsInput {
    id: ID
    # token: String
  }
  input updateDiskStorageInput {
    id: [ID]
    storageId: ID
  }

  input getListOfStorageDetailsInput {
    storageId: ID
  }
`
export default disk
