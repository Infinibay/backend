import logger from '../../logger.js'
import VM from './vmFucntions.js'
const updateVMFunction = (forupdatedata) => {
  return new Promise((resolve, reject) => {
    const vm = new VM()
    vm.updateVM(forupdatedata.name,forupdatedata.virtualMachineName, forupdatedata.ram, forupdatedata.cpu).then((response) => {
      resolve({"status":true})
    })
    .catch((error) => { 
      logger.error(error, error.message)
      reject({"status":false})
    })
  
  })
}
export default updateVMFunction
