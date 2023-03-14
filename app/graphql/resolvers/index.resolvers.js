const user_resolver = require('./user.resolver');
const vm_resolvers = require('./vm.resolver');
const notification_resolver = require('./notification .resolver');
const IOS_resolvers = require('./ISO.resolver');
module.exports = [ user_resolver, vm_resolvers, notification_resolver, IOS_resolvers ];
