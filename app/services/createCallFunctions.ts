import logger from '@main/logger'
import VM from './vmFucntions'

const createCallFunction = (fordata: any) => {
  return new Promise((resolve, reject) => {
    const vm = new VM()
    vm.createVM(fordata.name, fordata.ram, fordata.cpu, fordata.storage, fordata.confii.getConfigFile.Operating_System, fordata.iso).then((response) => {
      resolve({"status":true})
    }).catch((error) => {
      logger.error(error, error.message)
      reject(error)
    })
  })
}

export default createCallFunction
