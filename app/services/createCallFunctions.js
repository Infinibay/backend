import axios from 'axios'
import logger from '../../logger.js'

const createCallFunction = (fordata) => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: '2.0',
      method: 'createVMCall',
      params: {
        name: fordata.name,
        cpu: fordata.cpu,
        ram: fordata.ram,
        tpm: fordata.tpm,
        storage: fordata.storage,
        os_type: fordata.confii.getConfigFile.Operating_System,
        iso: fordata.iso
      },
      id: 1
    })

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'http://168.119.24.70:5001',
      headers: {
        'Content-Type': 'application/json'
      },
      data
    }

    axios(config)
      .then((response) => {
        resolve(response)
      })
      .catch((error) => {
        logger.error(error, error.message)
        reject(error)
      })
  })
}

export default createCallFunction
