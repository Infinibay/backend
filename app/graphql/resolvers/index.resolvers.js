const userResolver = require('./user.resolver')
const vmResolvers = require('./vm.resolver')
const notificationResolver = require('./notification .resolver')
const IOSResolvers = require('./IOS.resolver')
module.exports = [userResolver, vmResolvers, notificationResolver, IOSResolvers]
