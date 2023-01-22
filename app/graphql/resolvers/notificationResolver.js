import createNotification from './notification/create';
import allNotification from './notification/allNotification';
import forUpdateNotification from './notification/update';
import fordeleteNotification from './notification/delete';

const forNotificationExports= [
    createNotification,
    fordeleteNotification,
    allNotification,
    forUpdateNotification
]

export default forNotificationExports;