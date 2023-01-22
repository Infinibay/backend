import signUp from "./users/create";
import forDeleteUser from "./users/delete";
import login from "./users/login";
import forUsersList from "./users/usersList";
import forgetPassword from "./users/forgetPassword";
import forResetPassword from "./users/resetPassword";
import forUpdateUser from "./users/update";
import forConfigFile from "./users/configFile";
import userVirtualMachine from "./users/userVirtualMachine";


const foruserResolverExport = [
  signUp,
  forDeleteUser,
  login,
  forUsersList,
  forgetPassword,
  forResetPassword,
  forUpdateUser,
  forConfigFile,
  userVirtualMachine
];

export default foruserResolverExport