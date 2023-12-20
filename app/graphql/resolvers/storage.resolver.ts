import createStorageResolver from './mutations/createStorage.js'
import getStorageDetails from './queries/getStorageDetails.js'
import forUpdateStorage from './mutations/updateStorage.js'
import forDeleteStorage from './mutations/deleteStorage.js'
import StorageDetailsDisk from './queries/getDetailsOfStorages.js'

const forStorageExports = [
  createStorageResolver,
  getStorageDetails,
  forUpdateStorage,
  forDeleteStorage,
  StorageDetailsDisk
]

export default forStorageExports
