import jwt from "jsonwebtoken"
import GraphQLError from "graphql"
const config = process.env;

const isAuth = (token) => {
  if (!token) {
    console.log("A token is required for authentication");
    throw new GraphQLError("A token is required for authentication");
  }
  try {
    const decoded = jwt.verify(token, config.TOKEN_KEY);
    if (decoded.userType == "admin") {
      console.log(decoded.userType);
      return decoded;
    } else {
      console.log("Sorry Access Denied");
      throw new GraphQLError("Sorry Access Denied");
    }
  } catch (err) {
    console.log(err);
    throw new GraphQLError("Invalid Token");
  }
};

const isAuthForUser = (token) => {
  if (!token) {
    console.log("A token is required for authentication");
    throw new GraphQLError("A token is required for authentication");
  }
  try {
    const decoded = jwt.verify(token, config.TOKEN_KEY);
    if (decoded.userType == "user") {
      console.log(decoded.userType);
      return decoded;
    } else {
      console.log("Sorry Access Denied");
      throw new GraphQLError("Sorry Access Denied");
    }
  } catch (err) {
    console.log(err);
    throw new GraphQLError("Invalid Token");
  }
};

const AuthForBoth =(token)=>{
  if (!token) {
    console.log("A token is required for authentication");
    throw new GraphQLError("A token is required for authentication");
  }
  try {
    const decoded = jwt.verify(token, config.TOKEN_KEY);
if (decoded) {
  return decoded
}
    else {
      console.log("Sorry Access Denied");
      throw new GraphQLError("Sorry Access Denied");
    }
  } catch (err) {
    console.log(err);
    throw new GraphQLError("Invalid Token");
  }  
}



export { isAuth, isAuthForUser, AuthForBoth };
