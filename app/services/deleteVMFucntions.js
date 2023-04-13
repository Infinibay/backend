import axios from 'axios'
import logger from '../../logger.js'

const forDeleteFunction = (forName) => {
  return new Promise((resolve, reject) => {
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

export default forDeleteFunction
