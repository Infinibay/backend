import axios from 'axios'
import logger from '../../logger.js'
const updateVMFunction = (forupdatedata) => {
  return new Promise((resolve, reject) => {
    const data1 = JSON.stringify({
      jsonrpc: '2.0',
      method: 'updateAllCall',
      params: {
        name: forupdatedata.name,
        newname: forupdatedata.virtualMachineName,
        cpu: forupdatedata.cpu,
        ram: forupdatedata.ram
      },
      id: 1
    })
    console.log(data1)
    const data2 = JSON.stringify({
      jsonrpc: '2.0',
      method: 'updateMemoryCall',
      params: {
        name: forupdatedata.name,
        size: forupdatedata.data
      },
      id: 1
    })
    console.log(data2)
    // updateAllCall()
    const data3 = JSON.stringify({
      jsonrpc: '2.0',
      method: 'updateCpuCall',
      params: {
        name: forupdatedata.name,
        count: forupdatedata.count
      },
      id: 1
    })
    const totalData = { data3, data2, data1 }
    console.log(data3)
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'http://168.119.24.70:5001',
      headers: {
        'Content-Type': 'application/json'
      },
      data: totalData
    }
    axios(config)
      .then((response) => {
        resolve(response)
      })
      .catch((error) => {
        logger.error(error, error.message)
        reject(error)
      })
  }

  )
}
export default updateVMFunction
