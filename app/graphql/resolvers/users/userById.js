import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import AuthForBoth from "../../middleWare"
const forUserById = {
    Query: {
getUserByID: async (_parent, input) => {
    try {
      let token = input["input"]["token"];
      const forId = AuthForBoth(token).id;
      if (forId) {
        const findUserById = await prisma.user.findUnique({
          where: {
            id: forId,
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            Email: true,
            Deleted: true,
            userImage: true,
            userType: true,
            _count: true,
          },
        });
        console.log(findUserById);
        return findUserById;
      }
    } catch (error) {
      console.log(error);
      throw new GraphQLError("Something went wrong please try again later", {
        extensions: {
          StatusCode: 500,
        },
      });
    }
  },
}
}
export default forUserById