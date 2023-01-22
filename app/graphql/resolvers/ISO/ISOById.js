
import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare"


const ISOById = {
  Query: {
 getISOById: async (parent, input) => {
      try {
        let token = input["input"]["token"];
        let search = input["input"]["search"];
        const forAuth = AuthForBoth(token).id;
        if (forAuth) {
          const getISO = await prisma.ISO.findMany({
            where: {
              userId: forAuth,
            },
            select: {
              id: true,
              userId: true,
              Name: true,
              Type: true,
              createdAt: true,
              Size: true,
            },
          });
          if (search) {
            const forFind = await prisma.ISO.findMany({
              where: {
                userId: forAuth,
                Name: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            });
            console.log(forFind);
            return forFind;
          }

          console.log(getISO);
          return getISO;
        } else {
          throw new Error("Login again");
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
    },
}
}
export default  ISOById;