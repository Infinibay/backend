import createVMResolvers from './VM/create'
import forStatusVMResolvers from './VM/forStatus'
import allVMResolver from './VM/allVirtualMachine'
import userVirtualMachines from "./VM/userVirtualMachines"
import specificVirtualMachine from './VM/specificVirtualMachine'
import forVirtualMachineName from './VM/forVirtualMachineNames'
import updateVMResolvers from './VM/update'
import deleteVMResolvers from './VM/delete'

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