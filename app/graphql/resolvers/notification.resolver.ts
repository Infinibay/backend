import createNotification from './mutations/createNotification.js'
import allNotification from './queries/allNotification.js'
import forUpdateNotification from './mutations/updateNotification.js'
import fordeleteNotification from './mutations/deleteNotification.js'
import forUserNotification from './queries/userNotification.js'

const forNotificationExports = [
  createNotification,
  fordeleteNotification,
  allNotification,
  forUpdateNotification,
  forUserNotification
]

export default forNotificationExports
