const { errorType } = require('../helper/helperfunction')

const getErrorCode = errorName => {
  return errorType[errorName]
}

module.exports = getErrorCode