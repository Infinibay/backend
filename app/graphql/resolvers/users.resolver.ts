import signUp from './mutations/createUser'
import forDeleteUser from './mutations/deleteUser'
import login from './mutations/login'
import forUsersList from './queries/usersList'
import forgetPassword from './mutations/forgetPassword'
import forResetPassword from './mutations/resetPassword'
import forUpdateUser from './mutations/updateUser'
import userVirtualMachine from './queries/userVirtualMachine'
import forUserById from './queries/userById'
import forConfigFile from './queries/configFile'

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

export default foruserResolverExport;
