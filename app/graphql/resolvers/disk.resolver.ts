import createDisk from './mutations/createDisk'
import getAllUserDisk from './queries/getAllUserDisk'
import forUpdateaDisk from './mutations/updateDisk'
import forDeleteDisk from './mutations/deleteDisk'
import forSpecificDiskDetail from './queries/getSpecificDiskDetails'
import forGetUnAssignedDisk from './queries/getUnAssignedDisk'
import forGetAssignedDisk from './queries/getAssignedDisk'
import forAssignedDiskStorageID from './mutations/AssignedDiskStorageId'
import forGetListofStorage  from './queries/getStorageDiskList'

const diskExport = [
  createDisk,
  getAllUserDisk,
  forUpdateaDisk,
  forDeleteDisk,
  forSpecificDiskDetail,
  forGetUnAssignedDisk,
  forGetAssignedDisk,
  forAssignedDiskStorageID,
  forGetListofStorage
]

export default diskExport;
