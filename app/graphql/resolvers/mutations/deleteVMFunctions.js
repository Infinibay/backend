
import axios from 'axios'
import logger from '../../../../logger.js'
const forDeleteFunction = (forName) => {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      const data = JSON.stringify({
        jsonrpc: '2.0',
        method: 'deleteCall',
        params: {
          name: forName
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
      const reqq = await axios(config)
      resolve(reqq)
    } catch (error) {
      logger.error(error)
      reject(error)
    }
  })
}
export default forDeleteFunction
