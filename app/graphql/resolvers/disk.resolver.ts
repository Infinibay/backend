import createDisk from './mutations/createDisk.js'
import getAllUserDisk from './queries/getAllUserDisk.js'
import forUpdateaDisk from './mutations/updateDisk.js'
import forDeleteDisk from './mutations/deleteDisk.js'
import forSpecificDiskDetail from './queries/getSpecificDiskDetails.js'
import forGetUnAssignedDisk from './queries/getUnAssignedDisk.js'
import forGetAssignedDisk from './queries/getAssignedDisk.js'
import forAssignedDiskStorageID from './mutations/AssignedDiskStorageId.js'
import forGetListofStorage  from './queries/getStorageDiskList.js'
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

export default diskExport
