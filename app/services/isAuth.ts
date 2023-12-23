// import jwt from 'jsonwebtoken'
// import { GraphQLError } from 'graphql/error';
// import logger from '@main/logger'

// const isAuth = (token: any) => {
//   if (!token) {
//     throw new GraphQLError('A token is required for authentication')
//   }
//   try {
//     const decoded: any = jwt.verify(token, process.env.TOKENKEY ?? 'secret')
//     // eslint-disable-next-line eqeqeq
//     if (decoded.userType == 'admin') {
//       return decoded
//     } else {
//       throw new GraphQLError('Sorry Access Denied')
//     }
//   } catch (err: any) {
//     logger.error(err, err.message)
//     throw new GraphQLError('Invalid Token')
//   }
// }

// export default isAuth
