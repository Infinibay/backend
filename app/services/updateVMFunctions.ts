// import VM from './vmFucntions.js'
// import logger from '../logger.js'

// const updateVMFunction = (forupdatedata: any) => {
//   return new Promise((resolve, reject) => {
//     const vm = new VM()
//     vm.updateVM(forupdatedata.name,forupdatedata.virtualMachineName, forupdatedata.ram, forupdatedata.cpu).then((response) => {
//       resolve({"status":true})
//     })
//     .catch((error: any) => { 
//       logger.error(error, error.message)
//       reject({"status":false})
//     })
//   })
// }
// export default updateVMFunction
