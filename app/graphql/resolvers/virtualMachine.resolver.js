import createVMResolvers from './mutations/createVM.js'
import forStatusVMResolvers from './mutations/forStatus.js'
import allVMResolver from './queries/getAllVM.js'
import userVirtualMachines from './queries/userVirtualMachines.js'
import specificVirtualMachine from './queries/specificVirtualMachine.js'
import forVirtualMachineName from './queries/forVirtualMachineNames.js'
import updateVMResolvers from './mutations/updateVM.js'
import deleteVMResolvers from './mutations/deleteVM.js'

const forexport = [
  createVMResolvers,
  forStatusVMResolvers,
  allVMResolver,
  userVirtualMachines,
  specificVirtualMachine,
  forVirtualMachineName,
  updateVMResolvers,
  deleteVMResolvers
]
export default forexport
