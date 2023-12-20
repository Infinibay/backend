import jwt from 'jsonwebtoken'
import logger from '../../logger.js'
import GraphQLError from 'graphql'
const config = process.env

const isAuthForUser = (token) => {
  if (!token) {
    throw new GraphQLError('A token is required for authentication')
  }
  try {
    const decoded = jwt.verify(token, config.TOKENKEY)
    if (decoded.userType === 'user') {
      return decoded
    } else {
      throw new GraphQLError('Sorry Access Denied')
    }
  } catch (err) {
    logger.error(err, err.message)
    throw new GraphQLError('Invalid Token')
  }
}

export default isAuthForUser
