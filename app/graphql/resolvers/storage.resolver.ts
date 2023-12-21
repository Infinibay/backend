import createStorageResolver from './mutations/createStorage'
import getStorageDetails from './queries/getStorageDetails'
import forUpdateStorage from './mutations/updateStorage'
import forDeleteStorage from './mutations/deleteStorage'
import StorageDetailsDisk from './queries/getDetailsOfStorages'

const forStorageExports = [
  createStorageResolver,
  getStorageDetails,
  forUpdateStorage,
  forDeleteStorage,
  StorageDetailsDisk
]

export default forStorageExports;
