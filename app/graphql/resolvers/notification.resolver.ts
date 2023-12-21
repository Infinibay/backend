import createNotification from './mutations/createNotification';
import allNotification from './queries/allNotification';
import forUpdateNotification from './mutations/updateNotification';
import fordeleteNotification from './mutations/deleteNotification';
import forUserNotification from './queries/userNotification';

const forNotificationExports = [
  createNotification,
  fordeleteNotification,
  allNotification,
  forUpdateNotification,
  forUserNotification
];

export default forNotificationExports;
