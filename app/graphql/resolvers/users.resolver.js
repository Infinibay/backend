import signUp from './mutations/createUser.js'
import forDeleteUser from './mutations/deleteUser.js'
import login from './mutations/login.js'
import forUsersList from './queries/usersList.js'
import forgetPassword from './mutations/forgetPassword.js'
import forResetPassword from './mutations/resetPassword.js'
import forUpdateUser from './mutations/updateUser.js'
import userVirtualMachine from './queries/userVirtualMachine.js'
import forUserById from './queries/userById.js'
import forConfigFile from './queries/configFile.js'
const foruserResolverExport = [
  login,
  forUsersList,
  forResetPassword,
  forDeleteUser,
  forUpdateUser,
  forUserById,
  forConfigFile,
  userVirtualMachine,
  signUp,
  forgetPassword
]

export default foruserResolverExport
