import axios from 'axios'

const rpcUrl = process.env.RPC_URL ?? ''

const createCall = async (name: string, params: any) => {
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
