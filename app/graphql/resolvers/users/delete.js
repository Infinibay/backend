import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import isAuth from "../../middleWare"
const forDeleteUser = {
    Mutation: {
 //////for Delete User/////
 async deleteUser(root, input) {
    try {
      let token = input["input"]["token"];
      const forID = isAuth(token).id;
      if (forID) {
        const forDeleteUser = await prisma.user.update({
          where: {
            id: input["input"]["id"],
          },
          data: {
            Deleted: true,
          },
        });
        console.log(forDeleteUser);
        return "Deleted";
      }
    } catch (error) {
        console.log(error);
      throw new GraphQLError("Delete User Failed..!", {
        extensions: {
          StatusCode: 404,
        },
      });
    }
  }}
}
export default forDeleteUser;