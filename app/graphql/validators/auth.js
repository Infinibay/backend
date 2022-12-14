// const jwt = require("jsonwebtoken");
// const { startStandaloneServer } = require("apollo-server");
// // const helperfunction = require("../Utils/helperfunction");

// const config = process.env;

// const verifyToken = (req, res, next, context) => {
//   const token = req.headers.authorization || context.headers.authorization;
//   // req.body.token || req.query.token || req.headers["x-access-token"];
//   // input["header"]["x-access-token"]

//   if (!token) {
//     // return res.status(403).send("A token is required for authentication");
//     return res.status(403).send({
//       response: 403,
//       message: "A token is required for authentication",
//       status: false,
//     });
//   }
//   try {
//     const decoded = jwt.verify(token, config.TOKEN_KEY);
//     // input["input"]["userId"]
//     req.userId = decoded;
//     console.log((req.user = decoded));
//     // console.log(userId);
//   } catch (err) {
//     return res.status(401).send({
//       response: 401,
//       message: " Invalid Token",
//       status: false,
//     });
//   }
//   return next();
// };

// module.exports = verifyToken;
