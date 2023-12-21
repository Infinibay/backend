import logger from '@main/logger'
import VM from './vmFucntions'

const forDeleteFunction = (forName: any) => {
  return new Promise((resolve, reject) => {
    const vm = new VM()
    vm.deleteVM(forName).then((response) => {
      resolve({ "status": true })
    }).catch((error: any) => {
      logger.error(error, error.message)
      reject(error)
    })
  })
}

export default forDeleteFunction
