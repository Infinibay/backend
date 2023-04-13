import createDisk from './mutations/createDisk.js'
import getAllUserDisk from './queries/getAllUserDisk.js'
import forUpdateaDisk from './mutations/updateDisk.js'
import forDeleteDisk from './mutations/deleteDisk.js'
import forSpecificDiskDetail from './queries/getSpecificDiskDetails.js'
const diskExport = [
  createDisk,
  getAllUserDisk,
  forUpdateaDisk,
  forDeleteDisk,
  forSpecificDiskDetail
]

export default diskExport
