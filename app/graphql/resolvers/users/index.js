import signUp from "./create.js";
import forDeleteUser from "./delete.js";
import login from "./login.js";
import forUsersList from "./usersList.js";
import forgetPassword from "./forgetPassword.js";
import forResetPassword from "./resetPassword.js";
import forUpdateUser from "./update.js";
import forConfigFile from "./configFile.js";
import userVirtualMachine from "./userVirtualMachine.js";


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