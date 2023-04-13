import forexport from './virtualMachine.resolver.js'
import foruserResolverExport from './users.resolver.js'
import forISOexport from './ISO.resolver.js'
import forNotificationExports from './notification.resolver.js'
import diskExport from './disk.resolver.js'
import forStorageExports from './storage.resolver.js'
export default [
  forexport,
  foruserResolverExport,
  forISOexport,
  forNotificationExports,
  diskExport,
  forStorageExports
]
