import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {isAuth} from "../../middleWare";

const forAllSO = {
  Query: {
    //for get all ISO (admin )
    getAllISO: async (_root, input) => {
        try {
          let token = input["input"]["token"];
          let Search = input["input"]["Search"];
          const forAuth = isAuth(token).id;
          if (forAuth) {
            const forFindISO = await prisma.ISO.findMany({
              select: {
                id: true,
                Name: true,
                Type: true,
                createdAt: true,
                userId: true,
                Size: true,
              },
            });
            console.log(forFindISO);
            if (Search) {
              const searchToFind = await prisma.ISO.findMany({
                where: {
                  Name: {
                    contains: Search,
                    mode: "insensitive",
                  },
                },
              });
              console.log(searchToFind);
              return searchToFind;
            }
            console.log(forFindISO);
            return forFindISO;
          }
        } catch (error) {
          console.log(error);
          throw new GraphQLError("Please enter valid credentials", {
            extensions: {
              StatusCode: 401,
              code: "Failed ",
            },
          });
        }
      }
    }
}
export default forAllSO