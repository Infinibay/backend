let helperfunction = () => {
    let response = res.statusCode;
    let messages = messages;
    let status = true;
    let Data = Data;
    return res.status(200).send({ response: response, message: messages, status: status , Data:Data})
}

module.exports= helperfunction;