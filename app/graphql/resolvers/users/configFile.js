import file from "../../../configFile/config.json"
const forConfigFile = {
    Query: {
getConfigFile: async () => {
    try {
      const forConfigFile = file;
      console.log(forConfigFile);
      return forConfigFile;
    } catch (error) {
      console.log(error);
      return error;
    }
  }
}
}
export default forConfigFile