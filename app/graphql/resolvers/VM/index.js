import createVMResolvers from './create.js'
import forStatusVMResolvers from './forStatus.js'
import allVMResolver from './allVirtualMachine.js'
import userVirtualMachines from "./userVirtualMachines.js"
import specificVirtualMachine from './specificVirtualMachine.js'
import forVirtualMachineName from './forVirtualMachineNames.js'
import updateVMResolvers from './update.js'
import deleteVMResolvers from './delete.js'

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