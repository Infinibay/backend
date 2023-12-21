import axios from 'axios'
import logger from '../../logger.js'
import VM from './vmFucntions.js'

const forDeleteFunction = (forName) => {
  return new Promise((resolve, reject) => {
    const vm = new VM()
    vm.deleteVM(forName).then((response) => {
      resolve({ "status": true })
    }).catch((error) => {
      logger.error(error, error.message)
      reject(error)
    })

  })
}

export default forDeleteFunction
