import axios from "axios";

const rpcUrl = 'http://157.245.19.134:5001'


const createCall = async(name, params)=>{
    let data = {"jsonrpc": "2.0","method": name,"params": params,"id": 1}
    var config = {method: 'post',maxBodyLength: Infinity,url:rpcUrl ,headers: { 'Content-Type': 'application/json'}, data : JSON.stringify(data)};
    let reuslt =await axios(config)
    return reuslt
}


export  {createCall}