import createNotification from './create.js';
import allNotification from './allNotification.js';
import forUpdateNotification from './update.js';
import fordeleteNotification from './delete.js';

const forNotificationExports= [
    createNotification,
    fordeleteNotification,
    allNotification,
    forUpdateNotification
]

export default forNotificationExports;