const jwt = require('jsonwebtoken')
// const TOKEN_KEY = 'GraphQL-is-aw3some';
const config = process.env
// function getTokenPayload(token) {
//   return jwt.verify(token,  config.TOKEN_KEY);
// }

// function getUserId (req, authToken) {
//     console.log("hello");
//     try {
//         if (req) {
//             const authHeader = req.headers.authorization;
//             console.log(authHeader);
//             if (authHeader) {
//               const token = authHeader.replace('Bearer ', '');
//               console.log(token);
//               if (!token) {
//                 throw new Error('No token found');
//               }
//               const { userId } = getTokenPayload(token);
//               console.log(userId);
//               return userId;
//             }
//           } else if (authToken) {
//             const { userId } = getTokenPayload(authToken);
//             return userId;
//           }

//           throw new Error('Not authenticated');

//     } catch (error) {
//         console.log(error);
//     }
// }

const verifyToken = (req, next) => {
  console.log('verify')
  const token = req.headers.authorization
  console.log(token)
  if (!token) {
    throw new Error('A token is required for authentication')
  }
  try {
    const decoded = jwt.verify(token, config.TOKEN_KEY)
    req.user_id = decoded
    console.log(decoded)

    if (decoded.User_Type == 'admin') {
      console.log('admin')
      return next()
    } else {
      console.log('Sorry Access Denied')
      throw new Error('Sorry Access Denied')
    }
  } catch (err) {
    throw new Error('Invalid Token')
  }
  //   return next()
}

module.exports = {
  verifyToken
}
