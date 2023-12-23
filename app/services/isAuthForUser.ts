// import jwt from 'jsonwebtoken'
// import { GraphQLError } from 'graphql';
// import logger from '@main/logger'

// const config = process.env

// const isAuthForUser = (token: any) => {
//   if (!token) {
//     throw new GraphQLError('A token is required for authentication')
//   }
//   try {
//     const decoded: any = jwt.verify(token, config.TOKENKEY ?? 'secret')
//     if (decoded.userType === 'user') {
//       return decoded
//     } else {
//       throw new GraphQLError('Sorry Access Denied')
//     }
//   } catch (err: any) {
//     logger.error(err, err.message)
//     throw new GraphQLError('Invalid Token')
//   }
// }

// export default isAuthForUser
