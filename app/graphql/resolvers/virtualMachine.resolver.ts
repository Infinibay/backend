import createVMResolvers from './mutations/createVM';
import forStatusVMResolvers from './mutations/forStatus';
import allVMResolver from './queries/getAllVM';
import userVirtualMachines from './queries/userVirtualMachines';
import specificVirtualMachine from './queries/specificVirtualMachine';
import forVirtualMachineName from './queries/forVirtualMachineNames';
import updateVMResolvers from './mutations/updateVM';
import deleteVMResolvers from './mutations/deleteVM';

const forexport = [
  createVMResolvers,
  forStatusVMResolvers,
  allVMResolver,
  userVirtualMachines,
  specificVirtualMachine,
  forVirtualMachineName,
  updateVMResolvers,
  deleteVMResolvers
];
export default forexport;
