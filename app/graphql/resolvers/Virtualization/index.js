import axios from 'axios'

const rpcUrl = 'http://168.119.24.70:5001'

const createCall = async (name, params) => {
  const data = { jsonrpc: '2.0', method: name, params, id: 1 }
  const config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: rpcUrl,
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify(data)
  }
  const reuslt = await axios(config)
  return reuslt
}

export { createCall }
