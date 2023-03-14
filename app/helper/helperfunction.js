const { STATUS_CODES } = require('static-server');

const errorName = {
    UNAUTHORIZED : 'UNAUTHORIZED'
};
const errorType = {
    UNAUTHORIZED :{
        message : 'bad request',
        statusCode : 400
    }
};

module.exports = errorType, errorName;
